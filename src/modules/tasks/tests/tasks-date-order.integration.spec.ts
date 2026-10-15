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
import { TasksController } from '../tasks.controller';
import { TasksService } from '../tasks.service';
import { Task } from '../model/task.model';
import { TaskAssignee } from '../model/task-assignee.model';
import { ProjectMember } from '../../projects/model/project-member.model';
import { CreateTaskDto } from '../dto/create-task.dto';
import { Board } from '../../boards/model/board.model';
import { BoardColumn } from '../../columns/model/board-column.model';
import { Project } from '../../projects/model/project.model';
import { ProjectAccessService } from '../../projects/project-access.service';
import { User } from '../../users/model/users.model';
import { ActivityEventsService } from '../../activity-events/activity-events.service';
import { ActivityEvent } from '../../activity-events/model/activity-event.model';
import { TokenAuth } from '../../auth/jwt-auth.guard';
import { AccessTokenService } from '../../auth/access-token.service';
import type { IUserDataToken } from '../../auth/interfaces/interface';
import { TaskEntityType } from '../interfaces/task-entity.interface';
import { S3Service } from '../../s3/s3.service';
import { WsGateway } from '../../ws/ws.gateway';

const databaseUrl = process.env.BOARD_ARCHIVE_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const errorMessage =
  'Требуемое время готовности не может быть раньше даты начала работ';

/** Создаёт данные только в выделенной тестовой базе. */
async function persist<T extends Model>(
  record: T,
  values: Partial<Attributes<T>>
): Promise<T> {
  record.set(values);

  return record.save();
}

describeWithDatabase(
  'Task date order through HTTP with isolated PostgreSQL',
  () => {
    let sequelize: Sequelize;
    let app: INestApplication;
    let owner: User;
    let outsider: User;
    let secondExecutor: User;
    let project: Project;
    let column: BoardColumn;
    let task: Task;
    let sequence = 0;
    const ws = {
      emitTaskCreated: jest.fn(),
      emitTaskUpdated: jest.fn(),
      emitTaskActivityChanged: jest.fn()
    };

    beforeAll(async (): Promise<void> => {
      const url = new URL(databaseUrl!);
      if (!/^\/board_archive_test_[a-z0-9_]+$/.test(url.pathname)) {
        throw new Error(
          'Date order tests require a dedicated board_archive_test_* database'
        );
      }

      sequelize = new Sequelize(databaseUrl!, {
        dialect: 'postgres',
        models,
        logging: false,
        pool: { max: 2, min: 0 }
      });
      await sequelize.sync();
      owner = await persist(User.build(), {
        initial: 'Date Owner',
        login: 'Date Owner',
        serviceNumber: 'date-owner'
      });
      outsider = await persist(User.build(), {
        initial: 'Date Outsider',
        login: 'Date Outsider',
        serviceNumber: 'date-outsider'
      });
      secondExecutor = await persist(User.build(), {
        initial: 'Date second executor',
        login: 'Date second executor',
        serviceNumber: 'date-second-executor'
      });
      const module = await Test.createTestingModule({
        controllers: [TasksController],
        providers: [
          TasksService,
          ProjectAccessService,
          ActivityEventsService,
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
            // Внешний обмен токена подменён; guard и права проекта настоящие.
            useValue: {
              isEnabled: (): boolean => true,
              authenticate: async (token: string): Promise<User> => {
                if (token === 'date-owner-token') return owner;
                if (token === 'date-outsider-token') return outsider;
                if (token === 'date-second-executor-token')
                  return secondExecutor;

                throw new UnauthorizedException();
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
    });

    beforeEach(async (): Promise<void> => {
      sequence += 1;
      project = await persist(Project.build(), {
        title: 'Date order QA',
        prefix: `DTA${String.fromCharCode(65 + Math.floor(sequence / 26), 65 + (sequence % 26))}`,
        createdById: owner.id,
        taskCounter: 1
      });
      const board = await persist(Board.build(), {
        title: 'Date order board',
        projectId: project.id
      });
      column = await persist(BoardColumn.build(), {
        title: 'Date order column',
        boardId: board.id
      });
      task = await persist(Task.build(), {
        title: 'Existing task',
        taskNumber: 1,
        columnId: column.id,
        createdById: owner.id,
        startDate: new Date('2026-10-10T00:00:00Z'),
        dueDate: new Date('2026-10-20T00:00:00Z')
      });
      jest.clearAllMocks();
    });

    afterAll(async (): Promise<void> => {
      await app?.close();
      await sequelize?.close();
    });

    /** Проверяет общий HTTP-контракт создания и частичного обновления. */
    function write(
      method: 'post' | 'put',
      path: string,
      payload: Partial<CreateTaskDto>,
      token = 'date-owner-token'
    ): request.Test {
      return request(app.getHttpServer())
        [method](path)
        .auth(token, { type: 'bearer' })
        .send(payload);
    }

    /** Назначения меняют только тестовые данные выделенной базы. */
    async function assignExecutor(user: User): Promise<void> {
      await persist(ProjectMember.build(), {
        projectId: project.id,
        userId: user.id
      });
      await persist(TaskAssignee.build(), { taskId: task.id, userId: user.id });
    }

    it.each(Object.values(TaskEntityType))(
      'persists a selected %s for tasks and subtasks, replaces it and records clearing without changing other fields',
      async (type): Promise<void> => {
        const linkedEntity = {
          type,
          id: 12,
          name: 'Selected production',
          designation: 'QA-12'
        };
        for (const path of [
          `/columns/${column.id}/tasks`,
          `/tasks/${task.id}/subtasks`
        ]) {
          const created = await write('post', path, {
            title: 'Linked task',
            linkedEntity
          }).expect(201);
          expect((await Task.findByPk(created.body.id))?.linkedEntity).toEqual(
            linkedEntity
          );
          expect(
            (
              await request(app.getHttpServer())
                .get(`/tasks/${created.body.id}`)
                .auth('date-owner-token', { type: 'bearer' })
                .expect(200)
            ).body.linkedEntity
          ).toEqual(linkedEntity);
        }
        await write('put', `/tasks/${task.id}`, { linkedEntity }).expect(200);
        const next = { ...linkedEntity, id: 13, name: 'Replacement' };
        await write('put', `/tasks/${task.id}`, { linkedEntity: next }).expect(
          200
        );
        await write('put', `/tasks/${task.id}`, { priority: 'high' }).expect(
          200
        );
        expect((await task.reload()).linkedEntity).toEqual(next);
        await write('put', `/tasks/${task.id}`, { linkedEntity: null }).expect(
          200
        );
        expect((await task.reload()).linkedEntity).toBeNull();
        expect(task.title).toBe('Existing task');
        const last = await ActivityEvent.findOne({
          where: { entityId: String(task.id) },
          order: [['id', 'DESC']]
        });
        expect(last?.changes).toEqual([
          { field: 'linkedEntity', before: next, after: null }
        ]);
      }
    );

    it.each([
      { value: { type: 'material', id: 1, name: 'Invalid', designation: '' } },
      { value: { type: 'product', id: 0, name: 'Invalid', designation: '' } },
      { value: { type: 'cbed', id: '1', name: 'Invalid', designation: '' } },
      { value: { type: 'detal', id: 1, name: '', designation: '' } },
      {
        value: { type: 'detal', id: 1, name: 'x'.repeat(513), designation: '' }
      },
      { value: [] },
      { value: 'invalid' }
    ])(
      'rejects an invalid linked entity through the existing HTTP validation: %p',
      async ({ value }): Promise<void> => {
        await request(app.getHttpServer())
          .put(`/tasks/${task.id}`)
          .auth('date-owner-token', { type: 'bearer' })
          .send({ linkedEntity: value })
          .expect(400);
        expect((await task.reload()).linkedEntity).toBeNull();
        expect(ws.emitTaskUpdated).not.toHaveBeenCalled();
      }
    );

    it('lets each current executor update the start date and records the real actor without changing the deadline', async (): Promise<void> => {
      await assignExecutor(outsider);
      await assignExecutor(secondExecutor);
      for (const [index, [token, actor]] of (
        [
          ['date-outsider-token', outsider],
          ['date-second-executor-token', secondExecutor]
        ] as const
      ).entries()) {
        await write(
          'put',
          `/tasks/${task.id}`,
          { startDate: `2026-10-${12 + index}T00:00:00Z` },
          token
        ).expect(200);
        const last = await ActivityEvent.findOne({
          where: { entityId: String(task.id) },
          order: [['id', 'DESC']]
        });
        expect(last?.actorUserId).toBe(actor.id);
        expect(last?.changes.map(change => change.field)).toEqual([
          'startDate'
        ]);
      }
      expect((await task.reload()).startDate.toISOString()).toBe(
        '2026-10-13T00:00:00.000Z'
      );
      expect(task.dueDate.toISOString()).toBe('2026-10-20T00:00:00.000Z');
      expect(task.createdById).toBe(owner.id);
    });

    it.each(['task', 'subtask'])(
      'denies an assigned noncreator changing the %s deadline on its own',
      async (kind): Promise<void> => {
        await assignExecutor(outsider);
        const target =
          kind === 'task'
            ? task
            : await persist(Task.build(), {
                title: 'Executor subtask',
                taskNumber: 2,
                columnId: column.id,
                parentTaskId: task.id,
                createdById: owner.id,
                startDate: new Date('2026-10-10T00:00:00Z'),
                dueDate: new Date('2026-10-20T00:00:00Z')
              });

        if (kind === 'subtask') {
          await persist(TaskAssignee.build(), {
            taskId: target.id,
            userId: outsider.id
          });
        }

        const before = target.toJSON();

        for (const dueDate of ['2026-10-23T00:00:00Z', null]) {
          await write(
            'put',
            `/tasks/${target.id}`,
            { dueDate },
            'date-outsider-token'
          ).expect(403);
        }

        expect((await target.reload()).toJSON()).toEqual(before);
        expect(
          await ActivityEvent.count({ where: { projectId: project.id } })
        ).toBe(0);
        expect(ws.emitTaskUpdated).not.toHaveBeenCalled();
      }
    );

    it.each([
      { title: 'Other title' },
      { priority: 'high' },
      { dueDate: '2026-10-23T00:00:00Z' },
      { assigneeIds: [] },
      { tagIds: [] },
      { approvalStatus: 'yes' },
      { customAttributeValues: {} },
      {
        linkedEntity: {
          type: 'product',
          id: 1,
          name: 'Product',
          designation: ''
        }
      },
      { linkedEntity: null },
      { parentTaskId: null }
    ])(
      'denies executor changes to protected fields, including description and date in the same patch: %p',
      async (protectedPatch): Promise<void> => {
        await assignExecutor(outsider);
        const before = task.toJSON();
        await request(app.getHttpServer())
          .put(`/tasks/${task.id}`)
          .auth('date-outsider-token', { type: 'bearer' })
          .send({
            ...protectedPatch,
            description: '<p>Must not be saved</p>',
            startDate: '2026-10-12T00:00:00Z'
          })
          .expect(403);
        expect((await task.reload()).toJSON()).toEqual(before);
        expect(
          await ActivityEvent.count({ where: { projectId: project.id } })
        ).toBe(0);
        expect(ws.emitTaskUpdated).not.toHaveBeenCalled();
      }
    );

    it.each(['task', 'subtask'])(
      'allows every current executor to edit the %s description, alone or with its start date, through normal history',
      async (kind): Promise<void> => {
        await assignExecutor(outsider);
        await assignExecutor(secondExecutor);
        const target =
          kind === 'task'
            ? task
            : await persist(Task.build(), {
                title: 'Child task',
                taskNumber: 2,
                columnId: column.id,
                parentTaskId: task.id,
                createdById: owner.id,
                description: '<p>Initial</p>',
                startDate: new Date('2026-10-10T00:00:00Z'),
                dueDate: new Date('2026-10-20T00:00:00Z')
              });
        if (kind === 'subtask') {
          for (const user of [outsider, secondExecutor]) {
            await persist(TaskAssignee.build(), {
              taskId: target.id,
              userId: user.id
            });
          }
        }
        const originalTitle = target.title;
        for (const [index, [token, actor]] of (
          [
            ['date-outsider-token', outsider],
            ['date-second-executor-token', secondExecutor]
          ] as const
        ).entries()) {
          const description = `<p>Executor ${index}</p><img src="/test.png">`;
          await write(
            'put',
            `/tasks/${target.id}`,
            {
              description,
              ...(index ? { startDate: '2026-10-13T00:00:00Z' } : {})
            },
            token
          ).expect(200);
          const saved = await target.reload();
          expect(saved.description).toBe(description);
          expect(saved.title).toBe(originalTitle);
          expect(saved.createdById).toBe(owner.id);
          const last = await ActivityEvent.findOne({
            where: { entityId: String(target.id) },
            order: [['id', 'DESC']]
          });
          expect(last?.actorUserId).toBe(actor.id);
          expect(
            last?.changes.some(change => change.field === 'description')
          ).toBe(true);
        }
        // Очистка текста допустима; она не изменяет право на остальные поля.
        await write(
          'put',
          `/tasks/${target.id}`,
          { description: '' },
          'date-outsider-token'
        ).expect(200);
        expect((await target.reload()).description).toBe('');
        expect(ws.emitTaskUpdated).toHaveBeenCalledTimes(3);
      }
    );

    it.each(['task', 'subtask'])(
      'allows an unassigned project member to edit and clear a %s description with normal history',
      async (kind): Promise<void> => {
        await persist(ProjectMember.build(), {
          projectId: project.id,
          userId: outsider.id
        });

        const target =
          kind === 'task'
            ? task
            : await persist(Task.build(), {
                title: 'Unassigned child',
                taskNumber: 2,
                columnId: column.id,
                parentTaskId: task.id,
                createdById: owner.id
              });
        const before = target.toJSON();

        expect(await TaskAssignee.count({ where: { taskId: target.id } })).toBe(
          0
        );

        for (const description of ['<p>Text from a project member</p>', '']) {
          await write(
            'put',
            `/tasks/${target.id}`,
            { description },
            'date-outsider-token'
          ).expect(200);

          const response = await request(app.getHttpServer())
            .get(`/tasks/${target.id}`)
            .auth('date-outsider-token', { type: 'bearer' })
            .expect(200);

          expect(response.body.description).toBe(description);
          expect(response.body.title).toBe(before.title);
          expect(response.body.createdById).toBe(owner.id);
          expect((await target.reload()).dueDate).toEqual(before.dueDate);
          expect(target.startDate).toEqual(before.startDate);

          const history = await ActivityEvent.findOne({
            where: { entityId: String(target.id) },
            order: [['id', 'DESC']]
          });

          expect(history?.actorUserId).toBe(outsider.id);
          expect(
            history?.changes.some(change => change.field === 'description')
          ).toBe(true);
        }

        expect(ws.emitTaskUpdated).toHaveBeenCalledTimes(2);
      }
    );

    it.each([
      { title: 'Other title' },
      { startDate: '2026-10-12T00:00:00Z' },
      { dueDate: '2026-10-23T00:00:00Z' }
    ])(
      'rejects a member description patch mixed with protected fields: %p',
      async (protectedPatch): Promise<void> => {
        await persist(ProjectMember.build(), {
          projectId: project.id,
          userId: outsider.id
        });

        const before = task.toJSON();

        await write(
          'put',
          `/tasks/${task.id}`,
          { description: '<p>Must not be saved</p>', ...protectedPatch },
          'date-outsider-token'
        ).expect(403);

        expect((await task.reload()).toJSON()).toEqual(before);
        expect(
          await ActivityEvent.count({ where: { projectId: project.id } })
        ).toBe(0);
        expect(ws.emitTaskUpdated).not.toHaveBeenCalled();
      }
    );

    it('denies description writes without authentication, project access or an active task', async (): Promise<void> => {
      await request(app.getHttpServer())
        .put(`/tasks/${task.id}`)
        .send({ description: '<p>No session</p>' })
        .expect(401);

      await write(
        'put',
        `/tasks/${task.id}`,
        { description: '<p>No access</p>' },
        'date-outsider-token'
      ).expect(404);
      await assignExecutor(outsider);
      await task.destroy();
      await write(
        'put',
        `/tasks/${task.id}`,
        { description: '<p>Archived</p>' },
        'date-outsider-token'
      ).expect(404);

      expect(
        await ActivityEvent.count({ where: { projectId: project.id } })
      ).toBe(0);
      expect(ws.emitTaskUpdated).not.toHaveBeenCalled();
    });

    it('allows description editing in a child without inheriting start-date permission from its parent', async (): Promise<void> => {
      await assignExecutor(outsider);
      const child = await persist(Task.build(), {
        title: 'Child task',
        taskNumber: 2,
        columnId: column.id,
        parentTaskId: task.id,
        createdById: owner.id
      });
      await write(
        'put',
        `/tasks/${child.id}`,
        { description: '<p>Child description</p>' },
        'date-outsider-token'
      ).expect(200);

      await write(
        'put',
        `/tasks/${child.id}`,
        { startDate: '2026-10-12T00:00:00Z' },
        'date-outsider-token'
      ).expect(403);

      expect((await child.reload()).description).toBe(
        '<p>Child description</p>'
      );
      expect(ws.emitTaskUpdated).toHaveBeenCalledTimes(1);
    });

    it('keeps description editing after assignment removal but denies it after project access removal', async (): Promise<void> => {
      await assignExecutor(outsider);
      await TaskAssignee.destroy({
        where: { taskId: task.id, userId: outsider.id }
      });
      await write(
        'put',
        `/tasks/${task.id}`,
        { description: '<p>Still a project member</p>' },
        'date-outsider-token'
      ).expect(200);

      const before = (await task.reload()).toJSON();

      await ProjectMember.destroy({
        where: { projectId: project.id, userId: outsider.id }
      });
      await write(
        'put',
        `/tasks/${task.id}`,
        { description: '<p>Removed access</p>' },
        'date-outsider-token'
      ).expect(404);
      expect((await task.reload()).toJSON()).toEqual(before);
      expect(
        await ActivityEvent.count({ where: { projectId: project.id } })
      ).toBe(1);
      expect(ws.emitTaskUpdated).toHaveBeenCalledTimes(1);
    });

    it('rolls back an executor description when its accompanying start date is invalid', async (): Promise<void> => {
      await assignExecutor(outsider);
      const before = task.toJSON();
      await write(
        'put',
        `/tasks/${task.id}`,
        {
          description: '<p>Must not be saved</p>',
          startDate: '2026-10-21T00:00:00Z'
        },
        'date-outsider-token'
      ).expect(400);
      expect((await task.reload()).toJSON()).toEqual(before);
      expect(
        await ActivityEvent.count({ where: { projectId: project.id } })
      ).toBe(0);
      expect(ws.emitTaskUpdated).not.toHaveBeenCalled();
    });

    it('allows a creator who is not project owner to update all fields without being an executor', async (): Promise<void> => {
      await persist(ProjectMember.build(), {
        projectId: project.id,
        userId: outsider.id
      });
      task.createdById = outsider.id;
      await task.save();
      await write(
        'put',
        `/tasks/${task.id}`,
        {
          title: 'Creator edit',
          description: '<p>Creator description</p>',
          priority: 'high',
          startDate: '2026-10-11T00:00:00Z',
          dueDate: '2026-10-23T00:00:00Z',
          approvalStatus: 'yes',
          customAttributeValues: {},
          assigneeIds: [],
          tagIds: []
        },
        'date-outsider-token'
      ).expect(200);
      expect((await task.reload()).title).toBe('Creator edit');
      expect(task.createdById).toBe(outsider.id);
      await write('put', `/tasks/${task.id}`, {
        title: 'Owner override'
      }).expect(403);
      await write('put', `/tasks/${task.id}`, {
        dueDate: '2026-10-24T00:00:00Z'
      }).expect(403);
    });

    it('rejects an unassigned participant and a removed executor without changing date/history', async (): Promise<void> => {
      await assignExecutor(outsider);
      await TaskAssignee.destroy({
        where: { taskId: task.id, userId: outsider.id }
      });
      await write(
        'put',
        `/tasks/${task.id}`,
        { startDate: '2026-10-12T00:00:00Z' },
        'date-outsider-token'
      ).expect(403);
      expect((await task.reload()).startDate.toISOString()).toBe(
        '2026-10-10T00:00:00.000Z'
      );
      expect(
        await ActivityEvent.count({ where: { projectId: project.id } })
      ).toBe(0);
    });

    it('returns the real creator and current executors for inline subtask fields', async (): Promise<void> => {
      await assignExecutor(outsider);
      const child = await persist(Task.build(), {
        title: 'Executor subtask',
        taskNumber: 2,
        columnId: column.id,
        parentTaskId: task.id,
        createdById: outsider.id
      });
      await persist(TaskAssignee.build(), {
        taskId: child.id,
        userId: owner.id
      });

      const response = await request(app.getHttpServer())
        .get(`/tasks/${task.id}`)
        .auth('date-owner-token', { type: 'bearer' })
        .expect(200);

      expect(response.body.subtasks).toHaveLength(1);
      expect(response.body.subtasks[0]).toMatchObject({
        id: child.id,
        createdById: outsider.id,
        assignees: [{ taskId: child.id, userId: owner.id }]
      });
    });

    it('keeps date-order validation for an executor and still checks project access first', async (): Promise<void> => {
      await assignExecutor(outsider);
      await write(
        'put',
        `/tasks/${task.id}`,
        { startDate: '2026-10-21T00:00:00Z' },
        'date-outsider-token'
      ).expect(400);
      await ProjectMember.destroy({
        where: { projectId: project.id, userId: outsider.id }
      });
      await write(
        'put',
        `/tasks/${task.id}`,
        { startDate: '2026-10-12T00:00:00Z' },
        'date-outsider-token'
      ).expect(404);
      expect(ws.emitTaskUpdated).not.toHaveBeenCalled();
    });

    it.each(['task', 'subtask'])(
      'rejects reversed %s creation before numbers, ordering, history and broadcasts change',
      async kind => {
        const path =
          kind === 'task'
            ? `/columns/${column.id}/tasks`
            : `/tasks/${task.id}/subtasks`;
        const response = await write('post', path, {
          title: 'Invalid task',
          startDate: '2026-10-12T00:00:00Z',
          dueDate: '2026-10-11T00:00:00Z'
        }).expect(400);

        expect(response.body.message).toBe(errorMessage);
        expect(await Task.count({ where: { columnId: column.id } })).toBe(1);
        expect((await project.reload()).taskCounter).toBe(1);
        expect((await task.reload()).order).toBe(0);
        expect(
          await ActivityEvent.count({ where: { projectId: project.id } })
        ).toBe(0);
        expect(ws.emitTaskCreated).not.toHaveBeenCalled();
        expect(ws.emitTaskUpdated).not.toHaveBeenCalled();
      }
    );

    it.each([
      { dueDate: '2026-10-09T00:00:00Z' },
      { startDate: '2026-10-21T00:00:00Z' },
      { startDate: '2026-10-14T00:00:00Z', dueDate: '2026-10-13T00:00:00Z' }
    ])(
      'validates the effective pair for a partial update %j without saving other fields',
      async dates => {
        const updatedAt = task.updatedAt.getTime();
        const response = await write('put', `/tasks/${task.id}`, {
          ...dates,
          title: 'Must not be saved'
        }).expect(400);

        expect(response.body.message).toBe(errorMessage);
        await task.reload();
        expect(task.title).toBe('Existing task');
        expect(task.startDate.toISOString()).toBe('2026-10-10T00:00:00.000Z');
        expect(task.dueDate.toISOString()).toBe('2026-10-20T00:00:00.000Z');
        expect(task.updatedAt.getTime()).toBe(updatedAt);
        expect(
          await ActivityEvent.count({ where: { projectId: project.id } })
        ).toBe(0);
        expect(ws.emitTaskUpdated).not.toHaveBeenCalled();
      }
    );

    it.each(['task', 'subtask'])(
      'allows equal dates for %s creation and emits the normal history',
      async kind => {
        const path =
          kind === 'task'
            ? `/columns/${column.id}/tasks`
            : `/tasks/${task.id}/subtasks`;
        const response = await write('post', path, {
          title: 'Same day task',
          startDate: '2026-10-12T00:00:00+03:00',
          dueDate: '2026-10-11T21:00:00Z'
        }).expect(201);
        const saved = await Task.findByPk(response.body.id);

        expect(saved?.startDate.getTime()).toBe(saved?.dueDate.getTime());
        expect(saved?.parentTaskId).toBe(kind === 'subtask' ? task.id : null);
        expect(
          await ActivityEvent.count({ where: { projectId: project.id } })
        ).toBe(kind === 'subtask' ? 2 : 1);
        expect(ws.emitTaskCreated).toHaveBeenCalledTimes(1);
      }
    );

    it.each(['task', 'subtask'])(
      'preserves default dates for %s creation without supplied dates',
      async kind => {
        const path =
          kind === 'task'
            ? `/columns/${column.id}/tasks`
            : `/tasks/${task.id}/subtasks`;
        const response = await write('post', path, {
          title: 'Default dates'
        }).expect(201);
        const saved = await Task.findByPk(response.body.id);

        expect(saved?.startDate).toBeInstanceOf(Date);
        expect(saved?.dueDate.getTime()).toBe(saved?.startDate.getTime());
      }
    );

    it('allows moving the whole valid range forward and records both fields', async (): Promise<void> => {
      await write('put', `/tasks/${task.id}`, {
        startDate: '2026-10-21T00:00:00Z',
        dueDate: '2026-10-21T00:00:00Z'
      }).expect(200);
      await task.reload();

      expect(task.startDate.getTime()).toBe(task.dueDate.getTime());
      const events = await ActivityEvent.findAll({
        where: { projectId: project.id }
      });
      expect(events).toHaveLength(1);
      expect(events[0].changes.map(change => change.field)).toEqual([
        'dueDate',
        'startDate'
      ]);
      expect(ws.emitTaskUpdated).toHaveBeenCalledTimes(1);
    });

    it('does not repair historical dates or block edits unrelated to them', async (): Promise<void> => {
      await task.update({ dueDate: new Date('2026-10-09T00:00:00Z') });
      await write('put', `/tasks/${task.id}`, {
        title: 'Unrelated edit'
      }).expect(200);
      await task.reload();

      expect(task.title).toBe('Unrelated edit');
      expect(task.dueDate.toISOString()).toBe('2026-10-09T00:00:00.000Z');
      await write('put', `/tasks/${task.id}`, {
        dueDate: '2026-10-10T00:00:00Z'
      }).expect(200);
    });

    it('checks access before exposing date validation and rejects malformed dates through the DTO', async (): Promise<void> => {
      await write(
        'put',
        `/tasks/${task.id}`,
        { dueDate: '2026-10-01' },
        'date-outsider-token'
      ).expect(404);
      await write('put', `/tasks/${task.id}`, { dueDate: 'not-a-date' }).expect(
        400
      );
      expect(ws.emitTaskUpdated).not.toHaveBeenCalled();
    });

    it('validates against the locked current pair for concurrent partial edits', async (): Promise<void> => {
      const responses = await Promise.all([
        write('put', `/tasks/${task.id}`, {
          startDate: '2026-10-18T00:00:00Z'
        }),
        write('put', `/tasks/${task.id}`, { dueDate: '2026-10-12T00:00:00Z' })
      ]);

      expect(responses.map(response => response.status).sort()).toEqual([
        200, 400
      ]);
      expect(
        responses.find(response => response.status === 400)?.body.message
      ).toBe(errorMessage);
      await task.reload();
      expect(task.dueDate.getTime()).toBeGreaterThanOrEqual(
        task.startDate.getTime()
      );
      expect(
        await ActivityEvent.count({ where: { projectId: project.id } })
      ).toBe(1);
      expect(ws.emitTaskUpdated).toHaveBeenCalledTimes(1);
    });
  }
);
