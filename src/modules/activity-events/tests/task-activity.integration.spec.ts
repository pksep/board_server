import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import { Attributes, Model } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import request = require('supertest');
import models from '../../../configs/models';
import { TasksController } from '../../tasks/tasks.controller';
import { TasksService } from '../../tasks/tasks.service';
import { Task } from '../../tasks/model/task.model';
import { Board } from '../../boards/model/board.model';
import { BoardColumn } from '../../columns/model/board-column.model';
import { Project } from '../../projects/model/project.model';
import { ProjectMember } from '../../projects/model/project-member.model';
import { ProjectAccessService } from '../../projects/project-access.service';
import { User } from '../../users/model/users.model';
import { TokenAuth } from '../../auth/jwt-auth.guard';
import { AccessTokenService } from '../../auth/access-token.service';
import { IUserDataToken } from '../../auth/interfaces/interface';
import { S3Service } from '../../s3/s3.service';
import { WsGateway } from '../../ws/ws.gateway';
import { ActivityEventsService } from '../activity-events.service';
import {
  ActivityActionType,
  ActivityEntityType
} from '../activity-events.constants';
import { ActivityEvent } from '../model/activity-event.model';
import { ActivityEventRecipient } from '../model/activity-event-recipient.model';
import { TaskActivityController } from '../task-activity.controller';
import { TaskActivityService } from '../task-activity.service';
import {
  TaskActivityCounts,
  TaskActivityItem
} from '../interfaces/task-activity.interface';
import { ActivityEventPage } from '../interfaces/activity-event.interface';

const databaseUrl = process.env.BOARD_ARCHIVE_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

/** Записывает реальные модели только в выделенную тестовую базу. */
async function persist<T extends Model>(
  record: T,
  values: Partial<Attributes<T>>
): Promise<T> {
  record.set(values);

  return record.save();
}

describeWithDatabase(
  'Personal task activity through authenticated HTTP',
  () => {
    let sequelize: Sequelize;
    let app: INestApplication;
    let owner: User;
    let first: User;
    let second: User;
    let outsider: User;
    let project: Project;
    let column: BoardColumn;
    let otherColumn: BoardColumn;
    let task: Task;
    let activity: ActivityEventsService;
    let sequence = 0;
    const ws = {
      emitTaskCreated: jest.fn(),
      emitTaskUpdated: jest.fn(),
      emitTaskMoved: jest.fn(),
      emitTaskDeleted: jest.fn(),
      emitTaskRelocated: jest.fn(),
      emitTaskActivityChanged: jest.fn()
    };

    /** Выполняет настоящий guard; клиент не может выбрать ID получателя. */
    function http(user: User): ReturnType<typeof request.agent> {
      const agent = request.agent(app.getHttpServer());
      agent.set('Authorization', `Bearer activity-${user.id}`);

      return agent;
    }

    /** Читает публичный формат ленты с cursor-пагинацией. */
    async function feed(
      user: User,
      query = ''
    ): Promise<ActivityEventPage<TaskActivityItem>> {
      const response = await http(user)
        .get(`/activity/task-feed${query}`)
        .expect(200);

      return response.body;
    }

    /** Проверяет общий счётчик и распределение по проектам. */
    async function counts(user: User): Promise<TaskActivityCounts> {
      const response = await http(user)
        .get('/activity/task-feed/counts')
        .expect(200);

      return response.body;
    }

    beforeAll(async (): Promise<void> => {
      if (
        !/^\/board_archive_test_[a-z0-9_]+$/.test(
          new URL(databaseUrl!).pathname
        )
      )
        throw new Error('Dedicated test database required');
      sequelize = new Sequelize(databaseUrl!, {
        dialect: 'postgres',
        models,
        logging: false,
        pool: { max: 2, min: 0 }
      });
      await sequelize.sync();
      [owner, first, second, outsider] = await Promise.all(
        ['owner', 'first', 'second', 'outsider'].map(label =>
          persist(User.build(), {
            login: `Activity ${label}`,
            initial: `Activity ${label}`,
            serviceNumber: `activity-${label}`
          })
        )
      );
      const module = await Test.createTestingModule({
        controllers: [TasksController, TaskActivityController],
        providers: [
          TasksService,
          ProjectAccessService,
          ActivityEventsService,
          TaskActivityService,
          ...models.map(model => ({
            provide: getModelToken(model),
            useValue: model
          })),
          { provide: Sequelize, useValue: sequelize },
          { provide: WsGateway, useValue: ws },
          { provide: S3Service, useValue: {} },
          { provide: JwtService, useValue: new JwtService() },
          { provide: APP_GUARD, useClass: TokenAuth },
          {
            provide: AccessTokenService,
            useValue: {
              isEnabled: (): boolean => true,
              authenticate: async (token: string): Promise<User> => {
                const user = [owner, first, second, outsider].find(
                  candidate => token === `activity-${candidate.id}`
                );
                if (!user) throw new UnauthorizedException();

                return user;
              },
              toUserPayload: (user: User): IUserDataToken => ({
                id: user.id,
                login: user.login,
                serviceNumber: user.serviceNumber
              })
            }
          }
        ]
      }).compile();
      app = module.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({ transform: true, whitelist: true })
      );
      await app.init();
      activity = module.get(ActivityEventsService);
    });

    beforeEach(async (): Promise<void> => {
      sequence += 1;
      await ActivityEventRecipient.destroy({ where: {} });
      project = await persist(Project.build(), {
        title: 'Activity QA',
        prefix: `ACT${String.fromCharCode(64 + sequence)}`,
        createdById: owner.id
      });
      await Promise.all(
        [owner, first, second].map(user =>
          persist(ProjectMember.build(), {
            projectId: project.id,
            userId: user.id
          })
        )
      );
      const board = await persist(Board.build(), {
        title: 'QA board',
        projectId: project.id
      });
      column = await persist(BoardColumn.build(), {
        title: 'Queue',
        boardId: board.id
      });
      otherColumn = await persist(BoardColumn.build(), {
        title: 'Work',
        boardId: board.id
      });
      const response = await http(owner)
        .post(`/columns/${column.id}/tasks`)
        .send({
          title: 'Assigned task',
          assigneeIds: [first.id],
          startDate: '2026-10-08',
          dueDate: '2026-10-12'
        })
        .expect(201);
      task = response.body;
      jest.clearAllMocks();
    });

    afterAll(async (): Promise<void> => {
      await app?.close();
      await sequelize?.close();
    });

    it('shares the canonical history, actor and snapshot with assignees only', async (): Promise<void> => {
      const page = await feed(first);
      const history = await http(owner)
        .get(`/tasks/${task.id}/history`)
        .expect(200);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        id: history.body.items[0].id,
        actor: { id: owner.id },
        taskId: task.id,
        taskTitle: task.title,
        taskNumber: task.taskNumber,
        projectPrefix: project.prefix
      });
      expect(page.items[0].changes).toEqual(history.body.items[0].changes);
      expect(await counts(first)).toEqual({
        total: 1,
        projects: { [project.id]: 1 }
      });
      expect((await feed(owner)).items).toEqual([]);
      expect((await feed(outsider)).items).toEqual([]);
      expect(await counts(outsider)).toEqual({ total: 0, projects: {} });
    });

    it('notifies outgoing and incoming assignees once, then stops for the outgoing user', async (): Promise<void> => {
      await http(owner)
        .put(`/tasks/${task.id}`)
        .send({ assigneeIds: [second.id] })
        .expect(200);
      expect((await feed(first)).items).toHaveLength(2);
      expect((await feed(second)).items).toHaveLength(1);
      await http(owner)
        .put(`/tasks/${task.id}`)
        .send({ priority: 'urgent' })
        .expect(200);
      expect((await feed(first)).items).toHaveLength(2);
      expect((await feed(second)).items).toHaveLength(2);
      await http(owner)
        .put(`/tasks/${task.id}`)
        .send({ assigneeIds: [] })
        .expect(200);
      expect((await feed(second)).items).toHaveLength(3);
      await http(owner)
        .put(`/tasks/${task.id}`)
        .send({ title: 'No assignees' })
        .expect(200);
      expect((await feed(second)).items).toHaveLength(3);
      expect((await feed(first)).items).toHaveLength(2);
    });

    it('supports several assignees without duplicate recipients for the retained assignee', async (): Promise<void> => {
      await http(owner)
        .put(`/tasks/${task.id}`)
        .send({ assigneeIds: [first.id, second.id] })
        .expect(200);
      expect((await feed(first)).items).toHaveLength(2);
      expect((await feed(second)).items).toHaveLength(1);
      await http(owner)
        .put(`/tasks/${task.id}`)
        .send({ assigneeIds: [first.id] })
        .expect(200);
      expect((await feed(first)).items).toHaveLength(3);
      expect((await feed(second)).items).toHaveLength(2);
      await http(owner)
        .put(`/tasks/${task.id}`)
        .send({ priority: 'high' })
        .expect(200);
      expect((await feed(first)).items).toHaveLength(4);
      expect((await feed(second)).items).toHaveLength(2);
    });

    it('opens a relocated task in its current project and protects both project histories', async (): Promise<void> => {
      const destination = await persist(Project.build(), {
        title: 'Destination QA',
        prefix: `DEST${String.fromCharCode(64 + sequence)}`,
        createdById: owner.id,
        taskCounter: 20
      });
      await Promise.all(
        [owner, first].map(user =>
          persist(ProjectMember.build(), {
            projectId: destination.id,
            userId: user.id
          })
        )
      );
      const destinationBoard = await persist(Board.build(), {
        title: 'Destination board',
        projectId: destination.id
      });
      const destinationColumn = await persist(BoardColumn.build(), {
        title: 'Destination column',
        boardId: destinationBoard.id
      });
      await http(owner)
        .patch(`/tasks/${task.id}/move`)
        .send({ columnId: destinationColumn.id, order: 0 })
        .expect(200);
      const page = await feed(first);
      expect(page.items).toHaveLength(3); // Канонический журнал фиксирует исходящий и входящий перенос.
      expect(page.items[0]).toMatchObject({
        projectId: destination.id,
        taskProjectId: destination.id,
        taskNumber: 21,
        projectPrefix: destination.prefix
      });
      expect(page.items[1]).toMatchObject({
        projectId: project.id,
        taskProjectId: destination.id,
        taskNumber: 1,
        projectPrefix: project.prefix
      });
      const opened = await http(first).get(`/tasks/${task.id}`).expect(200);
      expect(opened.body.columnId).toBe(destinationColumn.id);
      expect(opened.body.column.boardId).toBe(destinationBoard.id);
      await ProjectMember.destroy({
        where: { projectId: destination.id, userId: first.id }
      });
      expect((await feed(first)).items).toEqual([]);
      expect((await counts(first)).total).toBe(0);
    });

    it('tracks moves, dates, priority and own changes using one event per operation', async (): Promise<void> => {
      await http(first)
        .put(`/tasks/${task.id}`)
        .send({
          startDate: '2026-10-09',
          dueDate: '2026-10-15',
          priority: 'high'
        })
        .expect(200);
      await http(owner)
        .patch(`/tasks/${task.id}/move`)
        .send({ columnId: otherColumn.id, order: 0 })
        .expect(200);
      const page = await feed(first);
      expect(page.items).toHaveLength(3);
      expect(page.items[0].actionType).toBe('moved');
      expect(page.items[1].actorUserId).toBe(first.id);
      expect(page.items[1].changes.map(change => change.field)).toEqual(
        expect.arrayContaining(['dueDate', 'startDate', 'priority'])
      );
      await http(owner)
        .put(`/tasks/${task.id}`)
        .send({ priority: 'high' })
        .expect(200);
      expect((await feed(first)).items).toHaveLength(3);
    });

    it('preserves the historical title and number after later changes', async (): Promise<void> => {
      await http(owner)
        .put(`/tasks/${task.id}`)
        .send({ title: 'Renamed task' })
        .expect(200);
      const page = await feed(first);
      expect(page.items[0].taskTitle).toBe('Renamed task');
      expect(page.items[1].taskTitle).toBe('Assigned task');
    });

    it('marks only this user/task through the opened snapshot; concurrent changes stay unread', async (): Promise<void> => {
      const snapshot = (await feed(first)).items[0].id;
      await http(owner)
        .put(`/tasks/${task.id}`)
        .send({ priority: 'urgent' })
        .expect(200);
      await http(first)
        .patch('/activity/task-feed/read')
        .send({ taskId: task.id, throughEventId: snapshot, userId: second.id })
        .expect(200);
      expect(await counts(first)).toEqual({
        total: 1,
        projects: { [project.id]: 1 }
      });
      const page = await feed(first);
      expect(page.items).toHaveLength(2);
      expect(page.items[0].readAt).toBeNull();
      expect(page.items[1].readAt).not.toBeNull();
      await http(outsider)
        .patch('/activity/task-feed/read')
        .send({ taskId: task.id, throughEventId: page.items[0].id })
        .expect(200);
      expect((await counts(first)).total).toBe(1);
      await http(first)
        .patch('/activity/task-feed/read')
        .send({ taskId: task.id, throughEventId: page.items[0].id })
        .expect(200);
      expect((await counts(first)).total).toBe(0);
      expect((await feed(first)).items).toHaveLength(2);
      expect(ws.emitTaskActivityChanged).toHaveBeenLastCalledWith(
        [first.id],
        true
      );
    });

    it('rechecks project access on every feed/count/read request', async (): Promise<void> => {
      await ProjectMember.destroy({
        where: { projectId: project.id, userId: first.id }
      });
      expect((await feed(first)).items).toEqual([]);
      expect((await counts(first)).total).toBe(0);
      await http(first)
        .patch('/activity/task-feed/read')
        .send({ taskId: task.id, throughEventId: 2147483647 })
        .expect(200);
      await persist(ProjectMember.build(), {
        projectId: project.id,
        userId: first.id
      });
      expect((await counts(first)).total).toBe(1);
    });

    it('paginates chronologically without duplicates and validates cursors/read boundaries', async (): Promise<void> => {
      for (const priority of ['low', 'high', 'urgent'])
        await http(owner)
          .put(`/tasks/${task.id}`)
          .send({ priority })
          .expect(200);
      const page = await feed(first, '?limit=2');
      expect(page.items).toHaveLength(2);
      const next = await feed(first, `?limit=2&beforeId=${page.nextCursor}`);
      expect(next.items).toHaveLength(2);
      expect(next.nextCursor).toBeNull();
      expect(
        new Set([...page.items, ...next.items].map(event => event.id)).size
      ).toBe(4);
      expect(page.items[0].id).toBeGreaterThan(page.items[1].id);
      await http(first).get('/activity/task-feed?limit=101').expect(400);
      await http(first).get('/activity/task-feed?beforeId=-1').expect(400);
      await http(first)
        .patch('/activity/task-feed/read')
        .send({ taskId: task.id, throughEventId: -1 })
        .expect(400);
      await request(app.getHttpServer()).get('/activity/task-feed').expect(401);
    });

    it('rolls back recipient pointers and emits nothing for a rolled-back event', async (): Promise<void> => {
      const before = await ActivityEventRecipient.count();
      const transaction = await sequelize.transaction();
      await activity.create(
        {
          projectId: project.id,
          entityType: ActivityEntityType.Task,
          entityId: String(task.id),
          actionType: ActivityActionType.Updated,
          changes: []
        },
        { transaction }
      );
      expect(ws.emitTaskActivityChanged).not.toHaveBeenCalled();
      await transaction.rollback();
      expect(await ActivityEventRecipient.count()).toBe(before);
      expect((await feed(first)).items).toHaveLength(1);
      expect(ws.emitTaskActivityChanged).not.toHaveBeenCalled();
    });

    it('does not create unread entries for a rejected date change', async (): Promise<void> => {
      const before = await ActivityEvent.count();
      await http(owner)
        .put(`/tasks/${task.id}`)
        .send({ dueDate: '2026-10-01' })
        .expect(400);
      expect(await ActivityEvent.count()).toBe(before);
      expect((await counts(first)).total).toBe(1);
      expect(ws.emitTaskActivityChanged).not.toHaveBeenCalled();
    });

    it('keeps archived task events available and openable through the canonical task endpoint', async (): Promise<void> => {
      await http(owner).delete(`/tasks/${task.id}`).expect(200);
      const page = await feed(first);
      expect(page.items[0].actionType).toBe('deleted');
      await http(first).get(`/tasks/${page.items[0].taskId}`).expect(200);
    });

    it('has idempotent deployment migration and does not backfill old history', async (): Promise<void> => {
      const migration = require('../../../../migrations/2026/08.10.2026/20261008120000-create-activity-event-recipients.js');
      const before = await ActivityEventRecipient.count();
      await migration.up(sequelize.getQueryInterface());
      await migration.up(sequelize.getQueryInterface());
      expect(await ActivityEventRecipient.count()).toBe(before);
    });
  }
);
