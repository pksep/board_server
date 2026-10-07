import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import { Attributes, Model, QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import request = require('supertest');
import models from '../../../configs/models';
import { TasksController } from '../tasks.controller';
import { TasksService } from '../tasks.service';
import { Task } from '../model/task.model';
import { TaskAssignee } from '../model/task-assignee.model';
import { TaskAttachment } from '../model/task-attachment.model';
import { Board } from '../../boards/model/board.model';
import { BoardColumn } from '../../columns/model/board-column.model';
import { ColumnStatus } from '../../columns/interfaces/column-status.interface';
import { Project } from '../../projects/model/project.model';
import { ProjectMember } from '../../projects/model/project-member.model';
import { ProjectAccessService } from '../../projects/project-access.service';
import { User } from '../../users/model/users.model';
import { ActivityEventsService } from '../../activity-events/activity-events.service';
import { TokenAuth } from '../../auth/jwt-auth.guard';
import { AccessTokenService } from '../../auth/access-token.service';
import type { IUserDataToken } from '../../auth/interfaces/interface';
import type { TaskGanttSnapshot } from '../interfaces/task-gantt.interface';
import { S3Service } from '../../s3/s3.service';
import { WsGateway } from '../../ws/ws.gateway';

const databaseUrl = process.env.BOARD_ARCHIVE_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

/** Сохраняет только изолированные тестовые записи через настоящие модели. */
async function persist<T extends Model>(
  record: T,
  values: Partial<Attributes<T>>
): Promise<T> {
  record.set(values);

  return record.save();
}

/** Проверяет реальное число проходов по назначениям, а не нестабильный лимит времени теста. */
function assignmentScanLoops(plan: unknown): number {
  if (!plan || typeof plan !== 'object') return 0;

  const current =
    'Relation Name' in plan &&
    plan['Relation Name'] === 'task_assignees' &&
    'Actual Loops' in plan
      ? Number(plan['Actual Loops'])
      : 0;
  const children =
    'Plans' in plan && Array.isArray(plan.Plans)
      ? plan.Plans.map(assignmentScanLoops)
      : [];

  return Math.max(current, ...children);
}

describeWithDatabase('Gantt API with isolated PostgreSQL', () => {
  let sequelize: Sequelize;
  let app: INestApplication;
  let service: TasksService;
  let owner: User;
  let outsider: User;
  let project: Project;
  let board: Board;
  let columns: BoardColumn[];
  let roots: Task[];
  let sequence = 0;

  beforeAll(async (): Promise<void> => {
    const url = new URL(databaseUrl!);
    if (!/^\/board_archive_test_[a-z0-9_]+$/.test(url.pathname)) {
      throw new Error(
        'Gantt tests require a dedicated board_archive_test_* database'
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
      initial: 'Gantt Owner',
      login: 'Gantt Owner',
      serviceNumber: 'gantt-owner'
    });
    outsider = await persist(User.build(), {
      initial: 'Gantt Outsider',
      login: 'Gantt Outsider',
      serviceNumber: 'gantt-outsider'
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
        { provide: WsGateway, useValue: {} },
        { provide: S3Service, useValue: {} },
        { provide: JwtService, useValue: new JwtService() },
        { provide: APP_GUARD, useClass: TokenAuth },
        {
          provide: AccessTokenService,
          // Подменён только внешний обмен токена; общий guard и проверка проекта остаются настоящими.
          useValue: {
            isEnabled: (): boolean => true,
            authenticate: async (token: string): Promise<User> => {
              if (token === 'gantt-owner-token') return owner;
              if (token === 'gantt-outsider-token') return outsider;

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
    service = module.get(TasksService);
  });

  beforeEach(async (): Promise<void> => {
    sequence += 1;
    project = await persist(Project.build(), {
      title: 'Gantt QA',
      prefix: `GNTA${String.fromCharCode(64 + sequence)}`,
      createdById: owner.id
    });
    board = await persist(Board.build(), {
      title: 'First',
      projectId: project.id,
      order: 3
    });
    columns = [];
    roots = [];
    for (const [index, status] of [
      ColumnStatus.Queued,
      ColumnStatus.InProgress,
      ColumnStatus.Completed
    ].entries()) {
      const column = await persist(BoardColumn.build(), {
        boardId: board.id,
        title: status,
        status,
        order: [2, 0, 1][index]
      });
      columns.push(column);
      roots.push(
        await persist(Task.build(), {
          title: `Root ${index}`,
          description: '<p>Do not download this body for Gantt</p>',
          taskNumber: index + 1,
          columnId: column.id,
          createdById: owner.id,
          order: index,
          startDate: new Date('2026-10-01T00:00:00Z'),
          dueDate: new Date('2026-10-04T00:00:00Z')
        })
      );
    }
    await persist(TaskAssignee.build(), {
      taskId: roots[0].id,
      userId: owner.id
    });
    await persist(TaskAssignee.build(), {
      taskId: roots[0].id,
      userId: outsider.id
    });
    await persist(TaskAssignee.build(), {
      taskId: roots[1].id,
      userId: outsider.id
    });
    await persist(TaskAttachment.build(), {
      taskId: roots[0].id,
      uploadedById: owner.id,
      fileName: 'private-attachment.txt',
      objectName: 'gantt-qa/test-only.txt',
      mimeType: 'text/plain',
      size: 12
    });
  });

  afterAll(async (): Promise<void> => {
    await app?.close();
    await sequelize?.close();
  });

  /** Проходит HTTP, общую авторизацию, DTO и канонический сервис. */
  async function read(
    query: Record<string, string> = {}
  ): Promise<TaskGanttSnapshot> {
    const response = await request(app.getHttpServer())
      .get(`/projects/${project.id}/gantt`)
      .query(query)
      .auth('gantt-owner-token', { type: 'bearer' })
      .expect(200);

    return response.body;
  }

  it('preserves real column statuses, dates, root-only rows and board/column/task order', async (): Promise<void> => {
    const earlier = await persist(Board.build(), {
      title: 'Earlier',
      projectId: project.id,
      order: 1
    });
    const column = await persist(BoardColumn.build(), {
      title: 'Unset',
      boardId: earlier.id
    });
    const first = await persist(Task.build(), {
      title: 'Earlier task',
      taskNumber: 10,
      columnId: column.id,
      createdById: owner.id
    });
    await persist(Task.build(), {
      title: 'Not a separate Gantt row',
      taskNumber: 11,
      columnId: columns[0].id,
      createdById: owner.id,
      parentTaskId: roots[0].id
    });

    const result = await read();
    expect(result.items.map(item => item.id)).toEqual([
      first.id,
      roots[1].id,
      roots[2].id,
      roots[0].id
    ]);
    expect(result.items.map(item => item.columnStatus)).toEqual([
      null,
      ColumnStatus.InProgress,
      ColumnStatus.Completed,
      ColumnStatus.Queued
    ]);
    expect(result.items.find(item => item.id === roots[0].id)).toMatchObject({
      startDate: '2026-10-01T00:00:00.000Z',
      dueDate: '2026-10-04T00:00:00.000Z',
      boardId: board.id
    });
    expect(result.total).toBe(4);
  });

  it('uses OR for multiple assignees without duplicates and retains every assignment', async (): Promise<void> => {
    const result = await read({
      assigneeIds: `${owner.id},${outsider.id},${owner.id}`
    });
    expect(result.items.map(item => item.id)).toEqual([
      roots[1].id,
      roots[0].id
    ]);
    expect(result.total).toBe(2);
    const ownerOnly = await read({ assigneeIds: String(owner.id) });
    expect(ownerOnly.total).toBe(1);
    expect(ownerOnly.items[0].assignees).toEqual([
      { userId: owner.id },
      { userId: outsider.id }
    ]);
    expect((await read({ assigneeIds: '2147483647' })).items).toEqual([]);
    // Оптимизация не должна вводить новый лимит 100 для прежнего выбора пользователей Ганта.
    const many = await read({
      assigneeIds: Array.from({ length: 600 }, (_, index) =>
        String(index + 1)
      ).join(',')
    });
    expect(many.total).toBe(2);
  });

  it('excludes archived tasks, columns and boards even if their tasks were not separately archived', async (): Promise<void> => {
    await roots[0].destroy();
    await columns[1].destroy();
    const archivedBoard = await persist(Board.build(), {
      title: 'Archived',
      projectId: project.id
    });
    const archivedColumn = await persist(BoardColumn.build(), {
      title: 'Still active column',
      boardId: archivedBoard.id
    });
    await persist(Task.build(), {
      title: 'Still active task',
      taskNumber: 10,
      columnId: archivedColumn.id,
      createdById: owner.id
    });
    await archivedBoard.destroy();

    expect((await read()).items.map(item => item.id)).toEqual([roots[2].id]);
  });

  it('returns the same filtered count for a collapsed group without loading task bodies or users', async (): Promise<void> => {
    const result = await read({
      assigneeIds: String(owner.id),
      summaryOnly: 'true'
    });
    expect(result).toEqual({ items: [], total: 1 });
    const full = await read({ assigneeIds: String(owner.id) });
    expect(full.items[0]).not.toHaveProperty('description');
    expect(full.items[0]).not.toHaveProperty('attachments');
    expect(full.items[0]).not.toHaveProperty('subtasks');
    expect(full.items[0].assignees[0]).not.toHaveProperty('user');
    const original = await service.getById(roots[0].id, owner.id);
    expect(original.description).toContain('Do not download');
    expect(original.attachments).toHaveLength(1);
  });

  it('does not disclose projects to unauthorized or removed participants', async (): Promise<void> => {
    await request(app.getHttpServer())
      .get(`/projects/${project.id}/gantt`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/projects/${project.id}/gantt`)
      .auth('invalid', { type: 'bearer' })
      .expect(401);
    await request(app.getHttpServer())
      .get(`/projects/${project.id}/gantt`)
      .auth('gantt-outsider-token', { type: 'bearer' })
      .expect(404);
    const member = await persist(ProjectMember.build(), {
      projectId: project.id,
      userId: outsider.id
    });
    await request(app.getHttpServer())
      .get(`/projects/${project.id}/gantt`)
      .auth('gantt-outsider-token', { type: 'bearer' })
      .expect(200);
    await member.destroy();
    await request(app.getHttpServer())
      .get(`/projects/${project.id}/gantt`)
      .auth('gantt-outsider-token', { type: 'bearer' })
      .expect(404);
    await project.destroy();
    await request(app.getHttpServer())
      .get(`/projects/${project.id}/gantt`)
      .auth('gantt-owner-token', { type: 'bearer' })
      .expect(404);
  });

  it.each([
    { assigneeIds: '-1' },
    { assigneeIds: '1,wrong' },
    { summaryOnly: 'maybe' }
  ])(
    'validates the common filter contract: %p',
    async (query): Promise<void> => {
      await request(app.getHttpServer())
        .get(`/projects/${project.id}/gantt`)
        .query(query)
        .auth('gantt-owner-token', { type: 'bearer' })
        .expect(400);
    }
  );

  it('loads a filtered 6000-task/600-user/20-board fixture with bounded queries and a reduced payload', async (): Promise<void> => {
    const loadProject = await persist(Project.build(), {
      title: 'Large Gantt QA',
      prefix: 'GANTTLOAD',
      createdById: owner.id
    });
    const loadBoards: Board[] = [];
    const columnIds: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const currentBoard = await persist(Board.build(), {
        title: `Load board ${index}`,
        projectId: loadProject.id,
        order: index
      });
      loadBoards.push(currentBoard);
      const currentColumn = await persist(BoardColumn.build(), {
        title: 'Completed',
        boardId: currentBoard.id,
        status: ColumnStatus.Completed
      });
      columnIds.push(currentColumn.id);
    }
    const users = await sequelize.query<{ id: number }>(
      `INSERT INTO users (initial, login, service_number, "createdAt", "updatedAt")
        SELECT 'Load ' || n, 'Load ' || n, 'gantt-load-' || n, NOW(), NOW()
        FROM generate_series(1, 600) n RETURNING id`,
      { type: QueryTypes.SELECT }
    );
    await sequelize.query(
      `INSERT INTO tasks (title, description, task_number, column_id, created_by_id, "order", start_date, due_date, "createdAt", "updatedAt")
        SELECT 'Load task ' || n, repeat('Synthetic task body ', 100), n,
          (ARRAY[:columnIds]::integer[])[(n - 1) % 20 + 1], :ownerId, n,
          '2026-10-01'::timestamptz, '2026-10-04'::timestamptz, NOW(), NOW()
        FROM generate_series(1, 6000) n`,
      { replacements: { columnIds, ownerId: owner.id } }
    );
    await sequelize.query(
      `INSERT INTO task_assignees (task_id, user_id, "createdAt", "updatedAt")
        SELECT id, (ARRAY[:userIds]::integer[])[(task_number - 1) % 600 + 1], NOW(), NOW()
        FROM tasks WHERE column_id IN (:columnIds)`,
      { replacements: { columnIds, userIds: users.map(user => user.id) } }
    );
    await sequelize.query(
      `INSERT INTO task_assignees (task_id, user_id, "createdAt", "updatedAt")
        SELECT id, :ownerId, NOW(), NOW() FROM tasks
        WHERE column_id IN (:columnIds) AND task_number % 100 = 0`,
      { replacements: { columnIds, ownerId: owner.id } }
    );

    const oldLogging = sequelize.options.logging;
    let queryCount = 0;
    let taskSelect = '';
    sequelize.options.logging = (sql: string): void => {
      queryCount += 1;
      const position = sql.indexOf('SELECT task.id, task.task_number');
      if (position !== -1) taskSelect = sql.slice(position);
    };
    try {
      const legacyStart = performance.now();
      const legacy: Task[] = [];
      for (const currentBoard of loadBoards)
        legacy.push(...(await service.getByBoard(currentBoard.id, owner.id)));
      const legacyMs = performance.now() - legacyStart;
      const legacyQueries = queryCount;
      const legacyBytes = Buffer.byteLength(JSON.stringify(legacy));
      queryCount = 0;
      const optimizedStart = performance.now();
      const result = await service.getProjectGantt(loadProject.id, owner.id, {
        assigneeIds: [owner.id]
      });
      const optimizedMs = performance.now() - optimizedStart;
      const optimizedQueries = queryCount;
      const optimizedBytes = Buffer.byteLength(JSON.stringify(result));

      // Защищает от коррелированного сканирования всех назначений для каждой задачи.
      const plans = await sequelize.query<{
        'QUERY PLAN': { Plan: unknown }[];
      }>(`EXPLAIN (ANALYZE, FORMAT JSON) ${taskSelect}`, {
        type: QueryTypes.SELECT
      });
      expect(assignmentScanLoops(plans[0]['QUERY PLAN'][0].Plan)).toBe(1);

      queryCount = 0;
      const allStart = performance.now();
      const all = await service.getProjectGantt(loadProject.id, owner.id);
      const allMs = performance.now() - allStart;
      const allQueries = queryCount;
      const allBytes = Buffer.byteLength(JSON.stringify(all));

      expect(legacy).toHaveLength(6000);
      expect(result.total).toBe(60);
      expect(
        result.items.every(item =>
          item.assignees.some(assigned => assigned.userId === owner.id)
        )
      ).toBe(true);
      expect(
        result.items.every(item => item.columnStatus === ColumnStatus.Completed)
      ).toBe(true);
      expect(optimizedQueries).toBeLessThanOrEqual(4);
      expect(legacyQueries).toBeGreaterThan(optimizedQueries * 20);
      expect(optimizedBytes).toBeLessThan(legacyBytes / 50);
      expect(all.total).toBe(6000);
      expect(allQueries).toBeLessThanOrEqual(4);
      expect(allBytes).toBeLessThan(legacyBytes / 4);
      console.log(
        'Gantt isolated benchmark',
        JSON.stringify({
          tasks: 6000,
          users: 600,
          boards: 20,
          matched: 60,
          legacyMs: Math.round(legacyMs),
          optimizedMs: Math.round(optimizedMs),
          legacyQueries,
          optimizedQueries,
          legacyBytes,
          optimizedBytes,
          allMs: Math.round(allMs),
          allQueries,
          allBytes
        })
      );
    } finally {
      sequelize.options.logging = oldLogging;
    }
  });
});
