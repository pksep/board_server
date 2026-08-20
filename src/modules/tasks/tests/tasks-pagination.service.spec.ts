import { Op } from 'sequelize';
import { TasksService } from '../tasks.service';

describe('TasksService paginated column loading', () => {
  const createService = (taskRepository: Record<string, jest.Mock>) => {
    const service = new TasksService(
      taskRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    jest
      .spyOn(service as any, 'assertColumnAccess')
      .mockResolvedValue(undefined);
    return service;
  };

  it('возвращает только запрошенную порцию и общее количество', async () => {
    const task = { id: 2, columnId: 10, order: 1 };
    const taskRepository = {
      count: jest.fn().mockResolvedValue(3),
      findAll: jest.fn().mockResolvedValue([task])
    };
    const service = createService(taskRepository);

    await expect(
      service.getByColumn(10, 7, { limit: 1, offset: 1 })
    ).resolves.toEqual({
      items: [task],
      total: 3,
      limit: 1,
      offset: 1,
      hasMore: true
    });
    expect(taskRepository.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 1,
        offset: 1,
        order: [
          ['order', 'ASC'],
          ['id', 'ASC']
        ]
      })
    );
  });

  it('включает корневую задачу, если поиск совпал с её подзадачей', async () => {
    const root = { id: 10, columnId: 10, order: 0 };
    const taskRepository = {
      count: jest.fn().mockResolvedValue(1),
      findAll: jest
        .fn()
        .mockResolvedValueOnce([{ id: 11, parentTaskId: 10 }])
        .mockResolvedValueOnce([root])
    };
    const service = createService(taskRepository);

    await expect(
      service.getByColumn(10, 7, {
        limit: 5,
        offset: 0,
        search: 'макет'
      })
    ).resolves.toEqual({
      items: [root],
      total: 1,
      limit: 5,
      offset: 0,
      hasMore: false
    });
    expect(taskRepository.count).toHaveBeenCalledWith({
      where: {
        columnId: 10,
        parentTaskId: null,
        id: { [Op.in]: [10] }
      }
    });
  });
});
