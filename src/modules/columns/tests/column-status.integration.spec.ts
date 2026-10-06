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
  const ws = { emitColumnCreated: jest.fn(), emitColumnUpdated: jest.fn() };

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
      controllers: [ColumnsController],
      providers: [
        ColumnsService,
        BoardsService,
        ProjectAccessService,
        ...models.map(model => ({
          provide: getModelToken(model),
          useValue: model
        })),
        { provide: Sequelize, useValue: sequelize },
        { provide: WsGateway, useValue: ws }
      ]
    }).compile();
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
      prefix: `COL${String.fromCharCode(64 + sequence)}`,
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
});
