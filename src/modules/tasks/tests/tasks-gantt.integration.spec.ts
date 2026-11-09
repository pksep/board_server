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
import type { Request } from 'express';
import models from '../../../configs/models';
import { TasksController } from '../tasks.controller';
import { TimeReportPermissionGuard } from '../time-report-permission.guard';
import { ExecutorPlanningPermissionGuard } from '../executor-planning-permission.guard';
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
import type { PersonalTaskPage } from '../interfaces/personal-task.interface';
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
            authenticateRequest: async (
              req: Request
            ): Promise<{ token: string; user: User }> => {
              const token =
                req.headers.authorization?.replace(/^Bearer /, '') ?? '';
              if (token === 'gantt-owner-token') return { token, user: owner };
              if (token === 'gantt-outsider-token')
                return { token, user: outsider };

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
    })
      .overrideGuard(ExecutorPlanningPermissionGuard)
      .useValue({ canActivate: (): boolean => true })
      .overrideGuard(TimeReportPermissionGuard)
      .useValue({ canActivate: (): boolean => true })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true })
    );
    await app.init();
    service = module.get(TasksService);
  });

  beforeEach(async (): Promise<void> => {
    sequence += 1;
    const prefixIndex = sequence - 1;
    const prefixSuffix = String.fromCharCode(
      65 + Math.floor(prefixIndex / 26),
      65 + (prefixIndex % 26)
    );
    project = await persist(Project.build(), {
      title: 'Gantt QA',
      prefix: `GNT${prefixSuffix}`,
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

  it('reads ERP executor assignments across member boards, including subtasks, before pagination', async (): Promise<void> => {
    const erpUserId = 800000 + project.id;
    await outsider.update({ erpId: String(erpUserId) });
    await persist(ProjectMember.build(), {
      projectId: project.id,
      userId: outsider.id
    });
    await board.update({ membersIds: [outsider.id] });

    // Ещё одна доска без собственного состава наследует участников проекта.
    const secondBoard = await persist(Board.build(), {
      title: 'Legacy members',
      projectId: project.id
    });
    const secondColumn = await persist(BoardColumn.build(), {
      title: 'Second',
      boardId: secondBoard.id
    });
    const subtask = await persist(Task.build(), {
      title: 'Assigned subtask',
      taskNumber: 50,
      columnId: secondColumn.id,
      parentTaskId: roots[2].id,
      createdById: owner.id,
      description: '<p>Subtask body</p>'
    });
    await persist(TaskAssignee.build(), {
      taskId: subtask.id,
      userId: outsider.id
    });

    const excludedBoard = await persist(Board.build(), {
      title: 'Not a member',
      projectId: project.id,
      membersIds: []
    });
    const excludedColumn = await persist(BoardColumn.build(), {
      title: 'Excluded',
      boardId: excludedBoard.id
    });
    const excluded = await persist(Task.build(), {
      title: 'Excluded assignment',
      taskNumber: 51,
      columnId: excludedColumn.id,
      createdById: owner.id
    });
    await persist(TaskAssignee.build(), {
      taskId: excluded.id,
      userId: outsider.id
    });

    const first = await request(app.getHttpServer())
      .get('/tasks/by-executor')
      .query({ erpUserId, limit: 1 })
      .auth('gantt-owner-token', { type: 'bearer' })
      .expect(200);
    expect(
      first.body.items.map(
        (item: PersonalTaskPage['items'][number]) => item.task.id
      )
    ).toEqual([roots[0].id]);
    expect(first.body).toMatchObject({ offset: 1, hasMore: true });
    expect(first.body.items[0].task.description).toBe(
      '<p>Do not download this body for Gantt</p>'
    );

    const rest = await request(app.getHttpServer())
      .get('/tasks/by-executor')
      .query({ erpUserId, offset: first.body.offset, limit: 100 })
      .auth('gantt-owner-token', { type: 'bearer' })
      .expect(200);
    expect(
      rest.body.items.map(
        (item: PersonalTaskPage['items'][number]) => item.task.id
      )
    ).toEqual([roots[1].id, subtask.id]);
    expect(rest.body.hasMore).toBe(false);

    // PK Board не является ID ERP; совпадение числа не должно раскрыть чужие назначения.
    const wrongId = await request(app.getHttpServer())
      .get('/tasks/by-executor')
      .query({ erpUserId: outsider.id })
      .auth('gantt-owner-token', { type: 'bearer' })
      .expect(200);
    expect(wrongId.body.items).toEqual([]);

    await secondBoard.destroy();
    await board.update({ membersIds: [] });
    const removed = await request(app.getHttpServer())
      .get('/tasks/by-executor')
      .query({ erpUserId })
      .auth('gantt-owner-token', { type: 'bearer' })
      .expect(200);
    expect(removed.body.items).toEqual([]);
  });

  it('excludes finished and archived columns only from ERP executor tasks before pagination', async (): Promise<void> => {
    const erpUserId = 850000 + project.id;
    await outsider.update({ erpId: String(erpUserId) });
    await persist(ProjectMember.build(), {
      projectId: project.id,
      userId: outsider.id
    });
    await board.update({ membersIds: [outsider.id] });
    await roots[0].update({
      timeNormMinutes: 90,
      linkedEntity: {
        type: 'detal',
        id: 17,
        name: 'Деталь',
        designation: 'Д-17'
      }
    });

    // Самые ранние задачи не должны занимать первую страницу активных назначений.
    await columns[0].update({ status: 'completed' });
    const completed = await service.getPersonalTasks(
      owner.id,
      { scope: 'assigned', limit: 1 },
      String(erpUserId)
    );
    expect(completed.items.map(item => item.task.id)).toEqual([roots[1].id]);
    expect(completed.hasMore).toBe(false);
    const personal = await service.getPersonalTasks(outsider.id, {
      scope: 'assigned'
    });
    expect(personal.items.map(item => item.task.id)).toContain(roots[0].id);

    await columns[0].update({ status: 'archived' });
    const archived = await service.getPersonalTasks(
      owner.id,
      { scope: 'assigned' },
      String(erpUserId)
    );
    expect(archived.items.map(item => item.task.id)).toEqual([roots[1].id]);

    // Снятие статуса возвращает задачу с её настоящей связью и нормой времени.
    await columns[0].update({ status: null });
    const active = await service.getPersonalTasks(
      owner.id,
      { scope: 'assigned' },
      String(erpUserId)
    );
    expect(active.items[0].task.timeNormMinutes).toBe(90);
    expect(active.items[0].task.linkedEntity).toEqual({
      type: 'detal',
      id: 17,
      name: 'Деталь',
      designation: 'Д-17'
    });

    // Не оставляем назначения этого проекта доступными следующему тесту с тем же пользователем.
    await board.update({ membersIds: [] });
  });

  it('keeps reader access, project membership, archives and existing personal lists independent', async (): Promise<void> => {
    const erpUserId = 900000 + project.id;
    await outsider.update({ erpId: String(erpUserId) });
    // Назначения существуют, но пользователь ещё не является участником проекта.
    const nonMember = await service.getPersonalTasks(
      owner.id,
      { scope: 'assigned' },
      String(erpUserId)
    );
    expect(nonMember.items).toEqual([]);
    await persist(ProjectMember.build(), {
      projectId: project.id,
      userId: outsider.id
    });
    const visible = await service.getPersonalTasks(
      owner.id,
      { scope: 'assigned' },
      String(erpUserId)
    );
    expect(visible.items.map(item => item.task.id)).toEqual([
      roots[0].id,
      roots[1].id
    ]);

    const personal = await service.getPersonalTasks(owner.id, {
      scope: 'assigned'
    });
    expect(personal.items.some(item => item.task.id === roots[0].id)).toBe(
      true
    );
    expect(personal.items.some(item => item.task.id === roots[1].id)).toBe(
      false
    );
    expect(
      personal.items.every(item => item.task.description === undefined)
    ).toBe(true);

    await ProjectMember.destroy({
      where: { projectId: project.id, userId: outsider.id }
    });
    const inaccessible = await service.getPersonalTasks(
      outsider.id,
      { scope: 'assigned' },
      String(erpUserId)
    );
    expect(inaccessible.items).toEqual([]);
    await persist(ProjectMember.build(), {
      projectId: project.id,
      userId: outsider.id
    });
    await roots[0].destroy();
    await columns[1].destroy();
    const archivedTasks = await service.getPersonalTasks(
      owner.id,
      { scope: 'assigned' },
      String(erpUserId)
    );
    expect(archivedTasks.items).toEqual([]);
    await project.destroy();
    expect(
      (
        await service.getPersonalTasks(
          owner.id,
          { scope: 'assigned' },
          String(erpUserId)
        )
      ).items
    ).toEqual([]);
  });

  it('validates executor IDs and pagination and requires authentication', async (): Promise<void> => {
    for (const query of [
      {},
      { erpUserId: 0 },
      { erpUserId: 'abc' },
      { erpUserId: 1.5 },
      { erpUserId: 1, limit: 101 },
      { erpUserId: 1, offset: -1 }
    ]) {
      await request(app.getHttpServer())
        .get('/tasks/by-executor')
        .query(query)
        .auth('gantt-owner-token', { type: 'bearer' })
        .expect(400);
    }
    await request(app.getHttpServer())
      .get('/tasks/by-executor')
      .query({ erpUserId: 1 })
      .expect(401);
  });

  it('reads bulk workload with full norms per executor, half-open dates and the canonical access/archive rules', async (): Promise<void> => {
    const ids = [970000 + project.id * 2, 970001 + project.id * 2];
    await owner.update({ erpId: String(ids[0]) });
    await outsider.update({ erpId: String(ids[1]) });

    for (const user of [owner, outsider]) {
      await persist(ProjectMember.build(), {
        projectId: project.id,
        userId: user.id
      });
    }

    await roots[0].update({
      startDate: new Date('2026-11-06T00:00:00Z'),
      dueDate: new Date('2026-11-07T23:59:59Z'),
      timeNormMinutes: 60
    });
    // Ровно правая граница не должна попасть ни по началу, ни по готовности.
    await roots[1].update({
      startDate: new Date('2026-11-08T00:00:00Z'),
      dueDate: new Date('2026-11-08T12:00:00Z'),
      timeNormMinutes: 30
    });
    const query = {
      erpUserIds: ids.join(','),
      start: '2026-11-06T00:00:00Z',
      end: '2026-11-08T00:00:00Z'
    };

    /** Читает реальный HTTP endpoint с общей авторизацией и валидацией DTO. */
    const readWorkload = async (): Promise<request.Response> =>
      request(app.getHttpServer())
        .get('/tasks/executor-workload')
        .query(query)
        .auth('gantt-owner-token', { type: 'bearer' })
        .expect(200);

    const visible = await readWorkload();
    expect(visible.body).toHaveLength(2);
    expect(visible.body).toEqual(
      expect.arrayContaining(
        ids.map(executorId =>
          expect.objectContaining({
            executorId,
            taskId: roots[0].id,
            timeNormMinutes: 60,
            projectId: project.id,
            projectName: project.title
          })
        )
      )
    );
    expect(visible.body[0]).not.toHaveProperty('description');

    // Исходный endpoint исполнителя получает настройку прав для того же календаря карточки.
    const personal = await service.getPersonalTasks(
      owner.id,
      { scope: 'assigned' },
      String(ids[0])
    );
    expect(
      personal.items.find(item => item.task.id === roots[0].id)
        ?.attributesOwnerOnly
    ).toBe(true);

    await board.update({ membersIds: [owner.id] });
    expect((await readWorkload()).body).toHaveLength(1);
    await board.update({ membersIds: null });
    await outsider.update({ ban: true });
    expect((await readWorkload()).body).toHaveLength(1);
    await outsider.update({ ban: false });

    await ProjectMember.destroy({
      where: { projectId: project.id, userId: outsider.id }
    });
    const hidden = await request(app.getHttpServer())
      .get('/tasks/executor-workload')
      .query(query)
      .auth('gantt-outsider-token', { type: 'bearer' })
      .expect(200);
    // Читатель вне проекта всё равно видит нагрузку оставшегося участника.
    expect(hidden.body).toEqual((await readWorkload()).body);
    expect(hidden.body.map(item => item.executorId)).toEqual([ids[0]]);

    for (const status of ['completed', 'in_review', 'archived']) {
      // Legacy in_review присутствует в старых данных, хотя больше не предлагается в UI.
      await sequelize.query(
        'UPDATE board_columns SET status = :status WHERE id = :id',
        { replacements: { status, id: columns[0].id } }
      );
      expect((await readWorkload()).body).toEqual([]);
    }

    await columns[0].reload();
    await columns[0].update({ status: ColumnStatus.Queued });
    expect((await readWorkload()).body).toHaveLength(1);
    await roots[0].destroy();
    expect((await readWorkload()).body).toEqual([]);
    await roots[0].restore();
    await columns[0].destroy();
    expect((await readWorkload()).body).toEqual([]);
    await columns[0].restore();
    await board.destroy();
    expect((await readWorkload()).body).toEqual([]);
    await board.restore();
    await project.destroy();
    expect((await readWorkload()).body).toEqual([]);
  });

  it('validates bulk executor workload filters and requires authentication', async (): Promise<void> => {
    const valid = {
      erpUserIds: '71,72',
      start: '2026-11-06T00:00:00Z',
      end: '2026-11-08T00:00:00Z'
    };

    for (const invalid of [
      { erpUserIds: '' },
      { erpUserIds: '0' },
      { erpUserIds: 'abc' },
      { erpUserIds: '71,71' },
      { erpUserIds: '1.5' },
      {
        erpUserIds: Array.from({ length: 501 }, (_, index) => index + 1).join(
          ','
        )
      },
      { start: 'bad' },
      { end: valid.start },
      { end: '2026-11-05T00:00:00Z' },
      { end: '2027-01-01T00:00:00Z' }
    ]) {
      await request(app.getHttpServer())
        .get('/tasks/executor-workload')
        .query({ ...valid, ...invalid })
        .auth('gantt-owner-token', { type: 'bearer' })
        .expect(400);
    }

    await request(app.getHttpServer())
      .get('/tasks/executor-workload')
      .query(valid)
      .expect(401);
  });

  it('includes other projects in executor planning without opening cards, personal lists or writes', async (): Promise<void> => {
    const erpUserId = 980000 + project.id;
    await outsider.update({ erpId: String(erpUserId) });
    const repair = await persist(Project.build(), {
      title: 'РЕМОНТ',
      prefix: `R${project.prefix}`,
      createdById: outsider.id,
      attributesOwnerOnly: false
    });
    await persist(ProjectMember.build(), {
      projectId: repair.id,
      userId: outsider.id
    });
    const repairBoard = await persist(Board.build(), {
      projectId: repair.id,
      title: 'РЕМОНТ',
      membersIds: [outsider.id]
    });
    const repairColumn = await persist(BoardColumn.build(), {
      boardId: repairBoard.id,
      title: 'В работе',
      status: ColumnStatus.InProgress
    });
    const repairTask = await persist(Task.build(), {
      title: 'Починить станок',
      taskNumber: 1,
      columnId: repairColumn.id,
      createdById: outsider.id,
      timeNormMinutes: 60,
      startDate: new Date('2026-11-09T08:00:00Z'),
      dueDate: new Date('2026-11-09T09:00:00Z')
    });
    await persist(TaskAssignee.build(), {
      taskId: repairTask.id,
      userId: outsider.id
    });

    // Viewer не состоит ни в проекте, ни в доске РЕМОНТ; роли производства проверены guard.
    const assignments = await request(app.getHttpServer())
      .get('/tasks/by-executor')
      .query({ erpUserId, limit: 1 })
      .auth('gantt-owner-token', { type: 'bearer' })
      .expect(200);
    expect(assignments.body).toMatchObject({ hasMore: false, offset: 1 });
    expect(assignments.body.items).toEqual([
      expect.objectContaining({
        projectId: repair.id,
        canReadTask: false,
        displayContext: expect.objectContaining({
          projectTitle: 'РЕМОНТ',
          boardId: repairBoard.id,
          boardTitle: 'РЕМОНТ',
          columnTitle: repairColumn.title,
          users: [
            expect.objectContaining({ id: outsider.id, login: outsider.login })
          ]
        }),
        task: expect.objectContaining({
          id: repairTask.id,
          timeNormMinutes: 60
        })
      })
    ]);
    const workload = await request(app.getHttpServer())
      .get('/tasks/executor-workload')
      .query({
        erpUserIds: String(erpUserId),
        start: '2026-11-09T00:00:00Z',
        end: '2026-11-10T00:00:00Z'
      })
      .auth('gantt-owner-token', { type: 'bearer' })
      .expect(200);
    expect(workload.body).toEqual([
      expect.objectContaining({
        executorId: erpUserId,
        projectName: 'РЕМОНТ',
        taskId: repairTask.id,
        timeNormMinutes: 60
      })
    ]);
    const personal = await service.getPersonalTasks(owner.id, {
      scope: 'assigned'
    });
    const personalIds = await service.getPersonalTaskIds(owner.id, {
      scope: 'assigned'
    });
    expect(personal.items.map(item => item.task.id)).not.toContain(
      repairTask.id
    );
    expect(personalIds).not.toContain(repairTask.id);
    await request(app.getHttpServer())
      .get(`/tasks/${repairTask.id}`)
      .auth('gantt-owner-token', { type: 'bearer' })
      .expect(404);
    await request(app.getHttpServer())
      .put(`/tasks/${repairTask.id}`)
      .send({ startDate: '2026-11-09T07:00:00Z' })
      .auth('gantt-owner-token', { type: 'bearer' })
      .expect(404);
    await repairTask.reload();
    expect(repairTask.startDate.toISOString()).toBe('2026-11-09T08:00:00.000Z');

    // Владелец того же проекта получает прежнюю карточку и явный признак доступа.
    const memberView = await service.getPersonalTasks(
      outsider.id,
      { scope: 'assigned' },
      String(erpUserId)
    );
    expect(
      memberView.items.find(item => item.task.id === repairTask.id)?.canReadTask
    ).toBe(true);
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
    expect(ownerOnly.total).toBe(2);
    expect(ownerOnly.items.map(item => item.id)).toEqual([
      roots[1].id,
      roots[0].id
    ]);
    expect(
      ownerOnly.items.find(item => item.id === roots[0].id)?.assignees
    ).toEqual([{ userId: owner.id }, { userId: outsider.id }]);
    expect((await read({ assigneeIds: '2147483647' })).items).toEqual([]);
    // Оптимизация не должна вводить новый лимит 100 для прежнего выбора пользователей Ганта.
    const many = await read({
      assigneeIds: Array.from({ length: 600 }, (_, index) =>
        String(index + 1)
      ).join(',')
    });
    expect(many.total).toBe(2);
  });

  it('shows self assignments and self-created delegated tasks only for self selection, without including unrelated or unassigned tasks', async (): Promise<void> => {
    const assignedToSelf = await persist(Task.build(), {
      title: 'Created by another participant, assigned to me',
      taskNumber: 20,
      columnId: columns[0].id,
      createdById: outsider.id,
      order: 5
    });
    await persist(TaskAssignee.build(), {
      taskId: assignedToSelf.id,
      userId: owner.id
    });
    const unrelated = await persist(Task.build(), {
      title: 'Created and assigned to another participant',
      taskNumber: 21,
      columnId: columns[0].id,
      createdById: outsider.id,
      order: 6
    });
    await persist(TaskAssignee.build(), {
      taskId: unrelated.id,
      userId: outsider.id
    });

    const self = await read({ assigneeIds: String(owner.id) });
    expect(self.items.map(item => item.id)).toEqual([
      roots[1].id,
      roots[0].id,
      assignedToSelf.id
    ]);
    expect(self.total).toBe(3);
    expect(self.items.some(item => item.id === roots[2].id)).toBe(false);
    expect(
      await read({ assigneeIds: String(owner.id), summaryOnly: 'true' })
    ).toEqual({
      items: [],
      total: self.total
    });
    const others = await read({ assigneeIds: String(outsider.id) });
    expect(others.items.map(item => item.id)).toEqual([
      roots[1].id,
      roots[0].id,
      unrelated.id
    ]);
    expect((await read()).total).toBe(5);

    // Архив и проверка проекта остаются обязательными и для делегированных карточек.
    await roots[1].destroy();
    expect((await read({ assigneeIds: String(owner.id) })).total).toBe(2);
    await request(app.getHttpServer())
      .get(`/projects/${project.id}/gantt`)
      .query({ assigneeIds: String(outsider.id) })
      .auth('gantt-outsider-token', { type: 'bearer' })
      .expect(404);
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
    expect(result).toEqual({ items: [], total: 2 });
    const full = await read({ assigneeIds: String(owner.id) });
    expect(full.total).toBe(result.total);
    expect(full.items[0]).not.toHaveProperty('description');
    expect(full.items[0]).not.toHaveProperty('attachments');
    expect(full.items[0]).not.toHaveProperty('subtasks');
    expect(full.items[0].assignees[0]).not.toHaveProperty('user');
    const original = await service.getById(roots[0].id, owner.id);
    expect(original.description).toContain('Do not download');
    expect(original.attachments).toHaveLength(1);
  });

  it('includes tasks without execution dates in assignee-filtered rows and collapsed counts', async (): Promise<void> => {
    // Старые задачи могут не иметь срока: чтение не требует заполнить форму.
    for (const task of roots) await task.update({ dueDate: null });

    const unrelated = await persist(Task.build(), {
      title: 'Other participant without an execution date',
      taskNumber: 10,
      columnId: columns[0].id,
      createdById: outsider.id,
      dueDate: null,
      order: 5
    });
    await persist(TaskAssignee.build(), {
      taskId: unrelated.id,
      userId: outsider.id
    });

    const self = await read({ assigneeIds: String(owner.id) });
    expect(self.items.map(item => item.id)).toEqual([roots[1].id, roots[0].id]);
    expect(self.items.every(item => item.dueDate === null)).toBe(true);
    expect(self.total).toBe(2);
    expect(
      await read({ assigneeIds: String(owner.id), summaryOnly: 'true' })
    ).toEqual({ items: [], total: self.total });

    const multiple = await read({ assigneeIds: `${owner.id},${outsider.id}` });
    expect(multiple.items.map(item => item.id)).toEqual([
      roots[1].id,
      roots[0].id,
      unrelated.id
    ]);
    expect(multiple.items.every(item => item.dueDate === null)).toBe(true);
    expect(multiple.total).toBe(3);
    expect(
      await read({
        assigneeIds: `${owner.id},${outsider.id}`,
        summaryOnly: 'true'
      })
    ).toEqual({ items: [], total: multiple.total });

    // Очистка выбора показывает также неназначенные задачи, но не дублирует назначения.
    const all = await read();
    expect(all.items.map(item => item.id)).toEqual([
      roots[1].id,
      roots[2].id,
      roots[0].id,
      unrelated.id
    ]);
    expect(all.total).toBe(4);
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

  /** Личные списки проверяются тем же HTTP-контуром, без отдельного обхода авторизации. */
  async function readPersonal(
    query: Record<string, string | string[]> = {},
    token = 'gantt-owner-token'
  ): Promise<PersonalTaskPage> {
    const response = await request(app.getHttpServer())
      .get('/tasks/personal')
      .query(query)
      .auth(token, { type: 'bearer' })
      .expect(200);

    return response.body;
  }

  it('personal lists separate creator and assignee, include subtasks/undated/completed tasks and omit bodies/files', async (): Promise<void> => {
    roots[0].dueDate = null;
    await roots[0].save();
    const child = await persist(Task.build(), {
      title: 'Personal child',
      taskNumber: 90,
      columnId: columns[0].id,
      createdById: outsider.id,
      parentTaskId: roots[0].id,
      dueDate: new Date('2026-10-02T00:00:00Z')
    });
    await persist(TaskAssignee.build(), { taskId: child.id, userId: owner.id });
    const ids = new Set([...roots, child].map(task => task.id));
    const created = await readPersonal({ scope: 'created', limit: '100' });
    expect(
      created.items
        .filter(item => ids.has(item.task.id))
        .map(item => item.task.id)
    ).toEqual([roots[1].id, roots[2].id, roots[0].id]);
    const assigned = await readPersonal({ scope: 'assigned', limit: '100' });
    expect(
      await service.getPersonalTaskIds(owner.id, { scope: 'assigned' })
    ).toEqual(
      assigned.items
        .map(item => item.task.id)
        .sort((left, right) => left - right)
    );
    expect(
      await service.getPersonalTaskIds(owner.id, { scope: 'created' })
    ).toEqual(
      created.items
        .map(item => item.task.id)
        .sort((left, right) => left - right)
    );
    expect(
      assigned.items
        .filter(item => ids.has(item.task.id))
        .map(item => item.task.id)
    ).toEqual([child.id, roots[0].id]);
    for (const item of assigned.items) {
      expect(item.task).not.toHaveProperty('attachments');
      expect(item.task).not.toHaveProperty('description');
      expect(item.task).not.toHaveProperty('subtasks');
      expect(
        item.task.assignees.some(assignment => assignment.userId === owner.id)
      ).toBe(true);
    }
    expect(
      assigned.items.find(item => item.task.id === roots[0].id)
    ).toMatchObject({ projectId: project.id, projectPrefix: project.prefix });
  });

  it.each([ColumnStatus.InProgress, ColumnStatus.Archived])(
    'filters personal lists by %s before pagination and returns the column status',
    async (status): Promise<void> => {
      await columns[0].update({ status });
      await columns[1].update({ status });
      await columns[2].update({ status: ColumnStatus.Completed });
      const allMatching = await readPersonal({
        scope: 'created',
        columnStatus: status,
        limit: '100'
      });
      const first = await readPersonal({
        scope: 'created',
        columnStatus: status,
        limit: '1'
      });
      expect(first.items).toHaveLength(1);
      expect(first.items[0].columnStatus).toBe(status);
      expect(first.hasMore).toBe(true);
      const second = await readPersonal({
        scope: 'created',
        columnStatus: status,
        limit: '1',
        offset: String(first.offset)
      });
      expect(second.items).toHaveLength(1);
      expect(second.items[0].columnStatus).toBe(status);
      expect(second.items[0].task.id).not.toBe(first.items[0].task.id);
      expect(second.hasMore).toBe(allMatching.items.length > 2);
      const assigned = await readPersonal({
        scope: 'assigned',
        columnStatus: status
      });
      expect(
        assigned.items
          .filter(item => item.projectId === project.id)
          .map(item => item.task.id)
      ).toEqual([roots[0].id]);
      const completed = await readPersonal({
        columnStatus: ColumnStatus.Completed
      });
      expect(
        completed.items.every(
          item => item.columnStatus === ColumnStatus.Completed
        )
      ).toBe(true);
      expect(
        completed.items
          .filter(item => item.projectId === project.id)
          .map(item => item.task.id)
      ).toEqual([roots[2].id]);
      expect(
        (
          await readPersonal({ columnStatus: ColumnStatus.Queued })
        ).items.filter(item => item.projectId === project.id)
      ).toEqual([]);
    }
  );

  it('maps legacy review filters and deduplicates them with the unified completion status', async (): Promise<void> => {
    await columns[0].update({ status: ColumnStatus.Completed });
    const current = await readPersonal({
      columnStatus: ColumnStatus.Completed
    });
    const legacy = await readPersonal({ columnStatus: 'in_review' });
    const combined = await readPersonal({
      columnStatuses: ['in_review', ColumnStatus.Completed]
    });
    expect(legacy.items.map(item => item.task.id)).toEqual(
      current.items.map(item => item.task.id)
    );
    expect(combined.items.map(item => item.task.id)).toEqual(
      current.items.map(item => item.task.id)
    );
  });

  it('combines selected personal task statuses before paginating', async (): Promise<void> => {
    await columns[0].update({ status: ColumnStatus.InProgress });
    await columns[1].update({ status: ColumnStatus.Queued });
    await columns[2].update({ status: ColumnStatus.Completed });
    const columnStatuses = [ColumnStatus.InProgress, ColumnStatus.Completed];
    const unfiltered = await readPersonal({ limit: '100' });
    const expected = unfiltered.items.filter(
      item =>
        item.columnStatus !== null && columnStatuses.includes(item.columnStatus)
    );
    const first = await readPersonal({ columnStatuses, limit: '1' });
    const second = await readPersonal({
      columnStatuses,
      limit: '1',
      offset: String(first.offset)
    });

    expect(first.hasMore).toBe(true);
    expect(second.hasMore).toBe(expected.length > 2);
    expect([...first.items, ...second.items].map(item => item.task.id)).toEqual(
      expected.slice(0, 2).map(item => item.task.id)
    );
    const combined = await readPersonal({ columnStatuses, limit: '100' });
    expect(combined.items.map(item => item.task.id)).toEqual(
      expected.map(item => item.task.id)
    );
  });

  it('personal task pages sort globally before pagination, with deterministic ties and null dates last', async (): Promise<void> => {
    roots[0].dueDate = null;
    roots[0].startDate = new Date('2030-01-01T00:00:00Z');
    await roots[0].save();
    roots[2].dueDate = new Date('2026-09-01T00:00:00Z');
    await roots[2].save();
    const all = await readPersonal({ limit: '100' });
    expect(all.hasMore).toBe(false);
    const collected: number[] = [];
    let offset = 0;
    let more = true;
    while (more) {
      const page = await readPersonal({ limit: '2', offset: String(offset) });
      collected.push(...page.items.map(item => item.task.id));
      expect(page.offset).toBe(offset + page.items.length);
      offset = page.offset;
      more = page.hasMore;
    }
    expect(collected).toEqual(all.items.map(item => item.task.id));
    expect(new Set(collected).size).toBe(collected.length);
    expect(all.items.at(-1)?.task.dueDate).toBeNull();
    const dates = all.items.map(item =>
      item.task.dueDate ? new Date(item.task.dueDate).getTime() : Infinity
    );
    expect(dates).toEqual([...dates].sort((left, right) => left - right));

    const order = { sortBy: 'startDate', sortDirection: 'desc' };
    const sorted = [...all.items].sort(
      (left, right) =>
        new Date(String(right.task.startDate)).getTime() -
          new Date(String(left.task.startDate)).getTime() ||
        left.task.id - right.task.id
    );
    const first = await readPersonal({ ...order, limit: '2' });
    const second = await readPersonal({
      ...order,
      limit: '2',
      offset: String(first.offset)
    });
    expect([...first.items, ...second.items].map(item => item.task.id)).toEqual(
      sorted.slice(0, 4).map(item => item.task.id)
    );
  });

  it('personal lists keep project access checks even for a creator/assignee and reject revoked/archived locations', async (): Promise<void> => {
    roots[0].createdById = outsider.id;
    await roots[0].save();
    const containsRoot = (page: PersonalTaskPage): boolean =>
      page.items.some(item => item.task.id === roots[0].id);
    expect(
      containsRoot(
        await readPersonal({ scope: 'created' }, 'gantt-outsider-token')
      )
    ).toBe(false);
    expect(
      containsRoot(
        await readPersonal({ scope: 'assigned' }, 'gantt-outsider-token')
      )
    ).toBe(false);
    const member = await persist(ProjectMember.build(), {
      projectId: project.id,
      userId: outsider.id
    });
    expect(
      containsRoot(
        await readPersonal({ scope: 'created' }, 'gantt-outsider-token')
      )
    ).toBe(true);
    await member.destroy();
    expect(
      containsRoot(
        await readPersonal({ scope: 'assigned' }, 'gantt-outsider-token')
      )
    ).toBe(false);
    await board.destroy();
    expect(containsRoot(await readPersonal({ scope: 'assigned' }))).toBe(false);
    expect(
      await service.getPersonalTaskIds(owner.id, { scope: 'assigned' })
    ).not.toContain(roots[0].id);
    await board.restore();
    await columns[0].destroy();
    expect(containsRoot(await readPersonal({ scope: 'assigned' }))).toBe(false);
    await columns[0].restore();
    await roots[0].destroy();
    expect(containsRoot(await readPersonal({ scope: 'assigned' }))).toBe(false);
    await roots[0].restore();
    await project.destroy();
    expect(containsRoot(await readPersonal({ scope: 'assigned' }))).toBe(false);
    expect(
      await service.getPersonalTaskIds(owner.id, { scope: 'assigned' })
    ).not.toContain(roots[0].id);
  });

  it.each([
    { scope: 'wrong' },
    { limit: '101' },
    { limit: '0' },
    { offset: '-1' },
    { columnStatus: 'invalid-status' },
    { columnStatuses: [ColumnStatus.Completed, 'invalid-status'] }
  ])('validates personal list parameters: %p', async (query): Promise<void> => {
    await request(app.getHttpServer())
      .get('/tasks/personal')
      .query(query)
      .auth('gantt-owner-token', { type: 'bearer' })
      .expect(400);
  });

  it('personal lists require authentication and do not accept an impersonated user ID', async (): Promise<void> => {
    await request(app.getHttpServer()).get('/tasks/personal').expect(401);
    const own = await readPersonal({
      userId: String(outsider.id),
      scope: 'created',
      limit: '100'
    });
    expect(own.items.every(item => item.task.createdById === owner.id)).toBe(
      true
    );
  });

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
      `INSERT INTO tasks (title, description, task_number, column_id, created_by_id, controller_ids, "order", start_date, due_date, "createdAt", "updatedAt")
        SELECT 'Load task ' || n, repeat('Synthetic task body ', 100), n,
          (ARRAY[:columnIds]::integer[])[(n - 1) % 20 + 1], :ownerId, ARRAY[:ownerId]::integer[], n,
          '2026-10-01'::timestamptz, '2026-10-04'::timestamptz, NOW(), NOW()
        FROM generate_series(1, 6000) n`,
      { replacements: { columnIds, ownerId: users[0].id } }
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
    // Большая выборка включает отдельно мои назначения и мои делегированные задачи.
    await sequelize.query(
      `UPDATE tasks SET created_by_id = :ownerId
        WHERE column_id IN (:columnIds) AND task_number % 100 = 1`,
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
      expect(result.total).toBe(120);
      expect(
        result.items.every(
          item =>
            item.assignees.some(assigned => assigned.userId === owner.id) ||
            (item.createdById === owner.id &&
              item.assignees.some(assigned => assigned.userId !== owner.id))
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
      queryCount = 0;
      const personal = await service.getPersonalTasks(owner.id, {
        scope: 'assigned',
        limit: 50
      });
      expect(personal.items).toHaveLength(50);
      expect(personal.hasMore).toBe(true);
      expect(queryCount).toBeLessThanOrEqual(4);
      queryCount = 0;
      const counterTaskIds = await service.getPersonalTaskIds(owner.id, {
        scope: 'assigned'
      });
      expect(counterTaskIds.length).toBeGreaterThan(50);
      expect(queryCount).toBe(1);
      expect(
        personal.items.every(item => counterTaskIds.includes(item.task.id))
      ).toBe(true);
      expect(
        personal.items.every(item =>
          item.task.assignees.some(assignment => assignment.userId === owner.id)
        )
      ).toBe(true);
      console.log(
        'Gantt isolated benchmark',
        JSON.stringify({
          tasks: 6000,
          users: 600,
          boards: 20,
          matched: result.total,
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
