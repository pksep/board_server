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
import { S3Service } from '../../s3/s3.service';
import { WsGateway } from '../../ws/ws.gateway';

const databaseUrl = process.env.BOARD_ARCHIVE_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const errorMessage = 'Дата исполнения не может быть раньше даты начала работ';

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
    let project: Project;
    let column: BoardColumn;
    let task: Task;
    let sequence = 0;
    const ws = { emitTaskCreated: jest.fn(), emitTaskUpdated: jest.fn() };

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
        prefix: `DTA${String.fromCharCode(64 + sequence)}`,
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
