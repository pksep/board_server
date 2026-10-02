import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import { Op, Transaction } from 'sequelize';
import { BoardsService } from './boards.service';
import { Board } from './model/board.model';
import { BoardColumn } from '../columns/model/board-column.model';
import { ProjectAccessService } from '../projects/project-access.service';
import { Task } from '../tasks/model/task.model';
import { WsGateway } from '../ws/ws.gateway';

describe('BoardsService.getByProject', () => {
  it('сохраняет проверку доступа и считает только верхнеуровневые задачи', async () => {
    const boards = [
      {
        id: 1,
        toJSON: () => ({ id: 1, title: 'Первая доска' })
      },
      {
        id: 2,
        toJSON: () => ({ id: 2, title: 'Вторая доска' })
      }
    ];
    const boardRepository = {
      findAll: jest.fn().mockResolvedValue(boards)
    };
    const columnRepository = {
      findAll: jest.fn().mockResolvedValue([
        { id: 10, boardId: 1 },
        { id: 11, boardId: 1 },
        { id: 20, boardId: 2 }
      ])
    };
    const taskRepository = {
      sequelize: {
        fn: jest.fn().mockReturnValue('count-expression'),
        col: jest.fn().mockReturnValue('id-column')
      },
      findAll: jest.fn().mockResolvedValue([
        { columnId: 10, tasksCount: '2' },
        { columnId: 20, tasksCount: 3 }
      ])
    };
    const projectAccess = {
      assertCanRead: jest.fn().mockResolvedValue(undefined)
    };
    const service = new BoardsService(
      boardRepository as any,
      columnRepository as any,
      taskRepository as any,
      {} as any,
      projectAccess as any
    );

    await expect(service.getByProject(7, 42)).resolves.toEqual([
      { id: 1, title: 'Первая доска', tasksCount: 2 },
      { id: 2, title: 'Вторая доска', tasksCount: 3 }
    ]);
    expect(projectAccess.assertCanRead).toHaveBeenCalledWith(7, 42);
    expect(taskRepository.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          columnId: { [Op.in]: [10, 11, 20] },
          parentTaskId: null
        },
        group: ['columnId'],
        raw: true
      })
    );
  });

  it('возвращает страницу досок и признак следующей порции', async () => {
    const boards = [
      {
        id: 2,
        toJSON: () => ({ id: 2, title: 'Вторая доска' })
      }
    ];
    const boardRepository = {
      count: jest.fn().mockResolvedValue(3),
      findAll: jest.fn().mockResolvedValue(boards)
    };
    const columnRepository = {
      findAll: jest.fn().mockResolvedValue([{ id: 20, boardId: 2 }])
    };
    const taskRepository = {
      sequelize: {
        fn: jest.fn().mockReturnValue('count-expression'),
        col: jest.fn().mockReturnValue('id-column')
      },
      findAll: jest.fn().mockResolvedValue([{ columnId: 20, tasksCount: '4' }])
    };
    const projectAccess = {
      assertCanRead: jest.fn().mockResolvedValue(undefined)
    };
    const service = new BoardsService(
      boardRepository as any,
      columnRepository as any,
      taskRepository as any,
      {} as any,
      projectAccess as any
    );

    await expect(
      service.getByProject(7, 42, { limit: 1, offset: 1 })
    ).resolves.toEqual({
      items: [{ id: 2, title: 'Вторая доска', tasksCount: 4 }],
      total: 3,
      limit: 1,
      offset: 1,
      hasMore: true
    });
    expect(boardRepository.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1, offset: 1 })
    );
  });
});

describe('BoardsService.create', () => {
  it('копирует названия, цвета и порядок столбцов текущей доски', async () => {
    const transaction = {} as Transaction;
    const sourceBoard = { id: 10 };
    const createdBoard = { id: 20, title: 'Новая доска' };
    const sourceColumns = [
      { id: 1, boardId: 10, title: 'Очередь', color: '#111111', order: 0 },
      { id: 2, boardId: 10, title: 'Готово', color: '#22aa22', order: 1 }
    ];
    const boardRepository = {
      sequelize: {
        transaction: jest.fn(
          async <T>(
            callback: (currentTransaction: Transaction) => Promise<T>
          ): Promise<T> => callback(transaction)
        )
      },
      findOne: jest.fn().mockResolvedValue(sourceBoard),
      max: jest.fn().mockResolvedValue(3),
      create: jest.fn().mockResolvedValue(createdBoard)
    };
    const columnRepository = {
      findAll: jest.fn().mockResolvedValue(sourceColumns),
      bulkCreate: jest.fn().mockResolvedValue([])
    };
    const projectAccess = {
      assertCanRead: jest.fn().mockResolvedValue(undefined)
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        BoardsService,
        { provide: getModelToken(Board), useValue: boardRepository },
        { provide: getModelToken(BoardColumn), useValue: columnRepository },
        { provide: getModelToken(Task), useValue: {} },
        { provide: WsGateway, useValue: {} },
        { provide: ProjectAccessService, useValue: projectAccess }
      ]
    }).compile();
    const service = moduleRef.get(BoardsService);

    await expect(
      service.create(7, { title: 'Новая доска', sourceBoardId: 10 }, 42)
    ).resolves.toBe(createdBoard);

    expect(projectAccess.assertCanRead).toHaveBeenCalledWith(7, 42);
    expect(boardRepository.findOne).toHaveBeenCalledWith({
      attributes: ['id'],
      where: { id: 10, projectId: 7 },
      transaction
    });
    expect(columnRepository.findAll).toHaveBeenCalledWith({
      where: { boardId: 10 },
      order: [['order', 'ASC']],
      transaction
    });
    expect(columnRepository.bulkCreate).toHaveBeenCalledWith(
      [
        { boardId: 20, title: 'Очередь', color: '#111111', order: 0 },
        { boardId: 20, title: 'Готово', color: '#22aa22', order: 1 }
      ],
      { transaction }
    );
  });
});
