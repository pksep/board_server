import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import { Attributes, DataTypes, Model, QueryInterface } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import request = require('supertest');
import models from '../../../configs/models';
import { BoardsService } from '../../boards/boards.service';
import { Board } from '../../boards/model/board.model';
import { Project } from '../../projects/model/project.model';
import { ProjectAccessService } from '../../projects/project-access.service';
import { ProjectMember } from '../../projects/model/project-member.model';
import { User } from '../../users/model/users.model';
import { WsGateway } from '../../ws/ws.gateway';
import { ColumnsController } from '../columns.controller';
import { ColumnsService } from '../columns.service';
import { ColumnStatus } from '../interfaces/column-status.interface';
import { BoardColumn } from '../model/board-column.model';
import { ColumnMovePermission } from '../interfaces/column-move-permission.interface';
import { TasksController } from '../../tasks/tasks.controller';
import { TimeReportPermissionGuard } from '../../tasks/time-report-permission.guard';
import { TasksService } from '../../tasks/tasks.service';
import { Task } from '../../tasks/model/task.model';
import { TaskAssignee } from '../../tasks/model/task-assignee.model';
import { ActivityEventsService } from '../../activity-events/activity-events.service';
import { ActivityEvent } from '../../activity-events/model/activity-event.model';
import { S3Service } from '../../s3/s3.service';

const databaseUrl = process.env.BOARD_ARCHIVE_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

/** Сохраняет тестовую запись с настоящими ограничениями PostgreSQL. */
async function persist<T extends Model>(
  record: T,
  values: Partial<Attributes<T>>
): Promise<T> {
  record.set(values);

  return record.save();
}

describeWithDatabase('Column status API with isolated PostgreSQL', () => {
  let sequelize: Sequelize;
  let app: INestApplication;
  let boards: BoardsService;
  let owner: User;
  let outsider: User;
  let board: Board;
  let column: BoardColumn;
  let project: Project;
  let sequence = 0;
  const ws = {
    emitColumnCreated: jest.fn(),
    emitColumnUpdated: jest.fn(),
    emitTaskMoved: jest.fn(),
    emitTaskRelocated: jest.fn(),
    emitTaskUpdated: jest.fn(),
    emitTaskActivityChanged: jest.fn()
  };

  /** Добавляет участника проекта, не делая его создателем чужих задач. */
  async function addParticipant(): Promise<void> {
    await persist(ProjectMember.build(), {
      projectId: project.id,
      userId: outsider.id
    });
  }

  /** Создаёт задачу с явно заданными создателем, колонкой и родителем. */
  async function taskIn(
    columnId: number,
    creatorId = owner.id,
    parentTaskId: number | null = null
  ): Promise<Task> {
    return persist(Task.build(), {
      title: 'Permission task',
      columnId,
      createdById: creatorId,
      taskNumber: (await Task.count()) + 1,
      order: 0,
      startDate: new Date('2026-10-13'),
      parentTaskId
    });
  }

  /** Создаёт целевую колонку той же доски, не меняя исходные правила. */
  async function targetColumn(
    movePermission = ColumnMovePermission.AnyActions
  ): Promise<BoardColumn> {
    return persist(BoardColumn.build(), {
      boardId: board.id,
      title: 'Target',
      order: 1,
      movePermission
    });
  }

  beforeAll(async (): Promise<void> => {
    if (
      !/^\/board_archive_test_[a-z0-9_]+$/.test(new URL(databaseUrl!).pathname)
    ) {
      throw new Error(
        'Column tests require a dedicated board_archive_test_* database'
      );
    }

    sequelize = new Sequelize(databaseUrl!, {
      dialect: 'postgres',
      models,
      logging: false,
      pool: { max: 2, min: 0 }
    });
    await sequelize.sync();
    const module = await Test.createTestingModule({
      controllers: [ColumnsController, TasksController],
      providers: [
        ColumnsService,
        BoardsService,
        ProjectAccessService,
        TasksService,
        ActivityEventsService,
        ...models.map(model => ({
          provide: getModelToken(model),
          useValue: model
        })),
        { provide: Sequelize, useValue: sequelize },
        { provide: WsGateway, useValue: ws },
        { provide: S3Service, useValue: {} }
      ]
    })
      .overrideGuard(TimeReportPermissionGuard)
      .useValue({ canActivate: (): boolean => true })
      .compile();
    app = module.createNestApplication();
    app.use(
      (
        req: { user?: { id: number }; headers: Record<string, string> },
        _res: unknown,
        next: () => void
      ): void => {
        req.user = { id: Number(req.headers['x-test-user']) };
        next();
      }
    );
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true })
    );
    await app.init();
    boards = module.get(BoardsService);
    owner = await persist(User.build(), {
      initial: 'Column owner',
      login: 'column-owner',
      serviceNumber: 'column-status-owner'
    });
    outsider = await persist(User.build(), {
      initial: 'Column outsider',
      login: 'column-outsider',
      serviceNumber: 'column-status-outsider'
    });
  });

  beforeEach(async (): Promise<void> => {
    sequence += 1;
    project = await persist(Project.build(), {
      title: 'Column status QA',
      prefix: `COL${String.fromCharCode(65 + Math.floor(sequence / 26), 65 + (sequence % 26))}`,
      createdById: owner.id
    });
    await persist(ProjectMember.build(), {
      projectId: project.id,
      userId: owner.id
    });
    board = await persist(Board.build(), {
      projectId: project.id,
      title: 'Column status board'
    });
    column = await persist(BoardColumn.build(), {
      boardId: board.id,
      title: 'Original column',
      color: '#123456',
      order: 0
    });
    jest.clearAllMocks();
  });

  afterAll(async (): Promise<void> => {
    await app?.close();
    await sequelize?.close();
  });

  it('creates columns without a chosen status by default and returns null on reload', async (): Promise<void> => {
    const response = await request(app.getHttpServer())
      .post(`/boards/${board.id}/columns`)
      .set('x-test-user', String(owner.id))
      .send({ title: 'New column' })
      .expect(201);
    expect(response.body.status).toBeNull();
    expect(response.body.movePermission).toBe(ColumnMovePermission.AnyActions);
    const snapshot = await request(app.getHttpServer())
      .get(`/boards/${board.id}/columns`)
      .set('x-test-user', String(owner.id))
      .expect(200);
    expect(
      snapshot.body.find((item: { id: number }) => item.id === response.body.id)
        .status
    ).toBeNull();
    expect(ws.emitColumnCreated.mock.calls[0][1].status).toBeNull();
  });

  it.each(Object.values(ColumnStatus))(
    'persists %s independently of the column title and header color',
    async (status): Promise<void> => {
      const response = await request(app.getHttpServer())
        .put(`/columns/${column.id}`)
        .set('x-test-user', String(owner.id))
        .send({ status })
        .expect(200);
      expect(response.body).toMatchObject({
        title: 'Original column',
        color: '#123456',
        status
      });
      expect((await BoardColumn.findByPk(column.id))?.status).toBe(status);
      expect(ws.emitColumnUpdated.mock.calls[0][1].status).toBe(status);
    }
  );

  it('preserves status for unrelated updates and clears it only when null is sent', async (): Promise<void> => {
    await column.update({ status: ColumnStatus.InProgress });
    await request(app.getHttpServer())
      .put(`/columns/${column.id}`)
      .set('x-test-user', String(owner.id))
      .send({ title: 'Renamed', color: '#654321' })
      .expect(200);
    expect((await column.reload()).status).toBe(ColumnStatus.InProgress);
    await request(app.getHttpServer())
      .put(`/columns/${column.id}`)
      .set('x-test-user', String(owner.id))
      .send({ status: null })
      .expect(200);
    expect((await column.reload()).toJSON()).toMatchObject({
      title: 'Renamed',
      color: '#654321',
      status: null
    });
  });

  it.each(['red', '', 'В Работе', 42])(
    'rejects unsupported status %s without changing the column',
    async (status): Promise<void> => {
      await request(app.getHttpServer())
        .put(`/columns/${column.id}`)
        .set('x-test-user', String(owner.id))
        .send({ status })
        .expect(400);
      expect((await column.reload()).status).toBeNull();
      expect(ws.emitColumnUpdated).not.toHaveBeenCalled();
      await request(app.getHttpServer())
        .post(`/boards/${board.id}/columns`)
        .set('x-test-user', String(owner.id))
        .send({ title: 'Invalid column', status })
        .expect(400);
    }
  );

  it('does not let another project member change a column outside their project', async (): Promise<void> => {
    await request(app.getHttpServer())
      .put(`/columns/${column.id}`)
      .set('x-test-user', String(outsider.id))
      .send({ status: ColumnStatus.Completed })
      .expect(404);
    expect((await column.reload()).status).toBeNull();
    expect(ws.emitColumnUpdated).not.toHaveBeenCalled();
  });

  it('copies selected and unset statuses to a new board from the current board', async (): Promise<void> => {
    await column.update({ status: ColumnStatus.Queued });
    await persist(BoardColumn.build(), {
      boardId: board.id,
      title: 'Unset',
      order: 1
    });
    const copied = await boards.create(
      project.id,
      { title: 'Copied board', sourceBoardId: board.id },
      owner.id
    );
    const columns = await BoardColumn.findAll({
      where: { boardId: copied.id },
      order: [['order', 'ASC']]
    });
    expect(columns.map(item => item.status)).toEqual([
      ColumnStatus.Queued,
      null
    ]);
    expect(columns[0].color).toBe('#123456');
  });

  it('migrates existing columns without assigning a status or changing their data', async (): Promise<void> => {
    const migration: {
      up(
        queryInterface: QueryInterface,
        types: typeof DataTypes
      ): Promise<void>;
      down(queryInterface: QueryInterface): Promise<void>;
    } = require('../../../../migrations/2026/05.10.2026/20261005120000-add-column-status');
    const queryInterface = sequelize.getQueryInterface();
    await migration.down(queryInterface);
    await migration.up(queryInterface, DataTypes);
    expect((await column.reload()).toJSON()).toMatchObject({
      title: 'Original column',
      color: '#123456',
      status: null,
      order: 0
    });
  });

  it.each(Object.values(ColumnMovePermission))(
    'persists outgoing permission %s without altering status or color',
    async movePermission => {
      const response = await request(app.getHttpServer())
        .put(`/columns/${column.id}`)
        .set('x-test-user', String(owner.id))
        .send({ movePermission })
        .expect(200);
      expect(response.body).toMatchObject({
        movePermission,
        color: '#123456',
        status: null
      });
      expect((await column.reload()).movePermission).toBe(movePermission);
      await request(app.getHttpServer())
        .put(`/columns/${column.id}`)
        .set('x-test-user', String(owner.id))
        .send({ title: 'Renamed' })
        .expect(200);
      expect((await column.reload()).movePermission).toBe(movePermission);
      expect(ws.emitColumnUpdated.mock.calls[0][1].movePermission).toBe(
        movePermission
      );
    }
  );

  it.each([
    { value: null },
    { value: '' },
    { value: 'invalid' },
    { value: 42 },
    { value: [] }
  ])('rejects an invalid outgoing rule: %j', async ({ value }) => {
    await request(app.getHttpServer())
      .put(`/columns/${column.id}`)
      .set('x-test-user', String(owner.id))
      .send({ movePermission: value })
      .expect(400);
    expect((await column.reload()).movePermission).toBe(
      ColumnMovePermission.AnyActions
    );
    await request(app.getHttpServer())
      .post(`/boards/${board.id}/columns`)
      .set('x-test-user', String(owner.id))
      .send({ title: 'Invalid', movePermission: value })
      .expect(400);
    expect(ws.emitColumnUpdated).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'keeps unrestricted movement for a participant with executor=%s while protecting fields',
    async (isExecutor): Promise<void> => {
      await addParticipant();
      const task = await taskIn(column.id);
      const target = await targetColumn();
      if (isExecutor) {
        await persist(TaskAssignee.build(), {
          taskId: task.id,
          userId: outsider.id
        });
      }

      await request(app.getHttpServer())
        .put(`/tasks/${task.id}`)
        .set('x-test-user', String(outsider.id))
        .send({ title: 'Forbidden field edit' })
        .expect(403);
      await request(app.getHttpServer())
        .put(`/tasks/${task.id}`)
        .set('x-test-user', String(outsider.id))
        .send({ dueDate: '2026-10-20T00:00:00Z' })
        .expect(403);
      await request(app.getHttpServer())
        .put(`/tasks/${task.id}`)
        .set('x-test-user', String(outsider.id))
        .send({ startDate: '2026-10-14T00:00:00Z' })
        .expect(isExecutor ? 200 : 403);

      await request(app.getHttpServer())
        .patch(`/tasks/${task.id}/move`)
        .set('x-test-user', String(outsider.id))
        .send({ columnId: target.id, order: 0 })
        .expect(200);
      expect((await task.reload()).columnId).toBe(target.id);
    }
  );

  it('allows only the task creator to leave a restricted column, not its assignee or project owner', async (): Promise<void> => {
    await addParticipant();
    await column.update({ movePermission: ColumnMovePermission.CreatorsOnly });
    const task = await taskIn(column.id, outsider.id);
    await persist(TaskAssignee.build(), { taskId: task.id, userId: owner.id });
    const target = await targetColumn();
    const beforeEvents = await ActivityEvent.count();
    await request(app.getHttpServer())
      .patch(`/tasks/${task.id}/move`)
      .set('x-test-user', String(owner.id))
      .send({ columnId: target.id, order: 0 })
      .expect(403);
    expect((await task.reload()).columnId).toBe(column.id);
    expect(await ActivityEvent.count()).toBe(beforeEvents);
    expect(ws.emitTaskMoved).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .patch(`/tasks/${task.id}/move`)
      .set('x-test-user', String(outsider.id))
      .send({ columnId: target.id, order: 0 })
      .expect(200);
    expect((await task.reload()).columnId).toBe(target.id);
  });

  it('does not restrict entering a protected column or ordering inside it', async (): Promise<void> => {
    await addParticipant();
    const task = await taskIn(column.id);
    const target = await targetColumn(ColumnMovePermission.CreatorsOnly);
    await request(app.getHttpServer())
      .patch(`/tasks/${task.id}/move`)
      .set('x-test-user', String(outsider.id))
      .send({ columnId: target.id, order: 0 })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/tasks/${task.id}/move`)
      .set('x-test-user', String(outsider.id))
      .send({ columnId: target.id, order: 1 })
      .expect(200);
    expect((await task.reload()).columnId).toBe(target.id);
  });

  it('checks child ownership before moving a whole hierarchy to another board', async (): Promise<void> => {
    await addParticipant();
    const root = await taskIn(column.id);
    const protectedChildColumn = await targetColumn(
      ColumnMovePermission.CreatorsOnly
    );
    const child = await taskIn(protectedChildColumn.id, outsider.id, root.id);
    const nextBoard = await persist(Board.build(), {
      projectId: project.id,
      title: 'Another board'
    });
    const nextColumn = await persist(BoardColumn.build(), {
      boardId: nextBoard.id,
      title: 'Destination'
    });
    const beforeEvents = await ActivityEvent.count();
    await request(app.getHttpServer())
      .patch(`/tasks/${root.id}/move`)
      .set('x-test-user', String(owner.id))
      .send({ columnId: nextColumn.id, order: 0 })
      .expect(403);
    expect((await root.reload()).columnId).toBe(column.id);
    expect((await child.reload()).columnId).toBe(protectedChildColumn.id);
    expect(await ActivityEvent.count()).toBe(beforeEvents);
    expect(ws.emitTaskRelocated).not.toHaveBeenCalled();
  });

  it('cannot bypass the rule by detaching a subtask into its parent column', async (): Promise<void> => {
    await addParticipant();
    await column.update({ movePermission: ColumnMovePermission.CreatorsOnly });
    const target = await targetColumn();
    const parent = await taskIn(target.id);
    const child = await taskIn(column.id, outsider.id, parent.id);
    await request(app.getHttpServer())
      .put(`/tasks/${child.id}`)
      .set('x-test-user', String(owner.id))
      .send({ parentTaskId: null, title: 'Should not save' })
      .expect(403);
    expect((await child.reload()).columnId).toBe(column.id);
    expect(child.parentTaskId).toBe(parent.id);
    expect(child.title).toBe('Permission task');
    await request(app.getHttpServer())
      .put(`/tasks/${child.id}`)
      .set('x-test-user', String(outsider.id))
      .send({ parentTaskId: null })
      .expect(200);
    expect((await child.reload()).columnId).toBe(target.id);
    expect(child.parentTaskId).toBeNull();
  });

  it('does not apply an outgoing restriction to ordinary task edits', async (): Promise<void> => {
    await addParticipant();
    await column.update({ movePermission: ColumnMovePermission.CreatorsOnly });
    const task = await taskIn(column.id, outsider.id);
    await request(app.getHttpServer())
      .put(`/tasks/${task.id}`)
      .set('x-test-user', String(outsider.id))
      .send({ title: 'Allowed edit' })
      .expect(200);
    expect((await task.reload()).title).toBe('Allowed edit');
    expect(task.columnId).toBe(column.id);
  });

  it('copies the outgoing rule to new boards along with existing column settings', async (): Promise<void> => {
    await column.update({ movePermission: ColumnMovePermission.CreatorsOnly });
    const copied = await boards.create(
      project.id,
      { title: 'Copy rule', sourceBoardId: board.id },
      owner.id
    );
    const copiedColumn = await BoardColumn.findOne({
      where: { boardId: copied.id }
    });
    expect(copiedColumn!.movePermission).toBe(
      ColumnMovePermission.CreatorsOnly
    );
  });
});
