import { Op } from 'sequelize';
import { BoardsService } from './boards.service';

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
});
