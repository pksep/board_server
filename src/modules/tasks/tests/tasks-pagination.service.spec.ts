import { Op } from 'sequelize';
import { TasksService } from '../tasks.service';

describe('TasksService paginated column loading', () => {
  const createService = (
    taskRepository: Record<string, jest.Mock>,
    assigneeRepository: Record<string, jest.Mock> = {},
    taskTagRepository: Record<string, jest.Mock> = {}
  ) => {
    const service = new TasksService(
      taskRepository as any,
      assigneeRepository as any,
      taskTagRepository as any,
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

  it('применяет исполнителей, теги и приоритет до пагинации', async () => {
    const root = { id: 10, columnId: 10, order: 0 };
    const taskRepository = {
      count: jest.fn().mockResolvedValue(1),
      findAll: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 11, parentTaskId: 10 },
          { id: 12, parentTaskId: null }
        ])
        .mockResolvedValueOnce([root])
    };
    const assigneeRepository = {
      findAll: jest.fn().mockResolvedValue([{ taskId: 11 }, { taskId: 12 }])
    };
    const taskTagRepository = {
      findAll: jest.fn().mockResolvedValue([{ taskId: 11 }, { taskId: 13 }])
    };
    const service = createService(
      taskRepository,
      assigneeRepository,
      taskTagRepository
    );

    await expect(
      service.getByColumn(10, 7, {
        limit: 5,
        offset: 0,
        assigneeIds: [7],
        priorities: ['high'],
        tagIds: [3],
        includeSubtasks: true
      })
    ).resolves.toEqual({
      items: [root],
      total: 1,
      limit: 5,
      offset: 0,
      hasMore: false
    });
    expect(taskRepository.findAll).toHaveBeenNthCalledWith(1, {
      where: {
        columnId: 10,
        priority: { [Op.in]: ['high'] }
      },
      attributes: ['id', 'parentTaskId'],
      raw: true
    });
    expect(assigneeRepository.findAll).toHaveBeenCalledWith({
      where: {
        taskId: { [Op.in]: [11, 12] },
        userId: { [Op.in]: [7] }
      },
      attributes: ['taskId'],
      raw: true
    });
    expect(taskTagRepository.findAll).toHaveBeenCalledWith({
      where: {
        taskId: { [Op.in]: [11, 12] },
        projectTagId: { [Op.in]: [3] }
      },
      attributes: ['taskId'],
      raw: true
    });
    expect(taskRepository.count).toHaveBeenCalledWith({
      where: {
        columnId: 10,
        parentTaskId: null,
        id: { [Op.in]: [10] }
      }
    });
  });

  it('не учитывает подзадачи, когда их показ выключен', async () => {
    const taskRepository = {
      count: jest.fn().mockResolvedValue(0),
      findAll: jest
        .fn()
        .mockResolvedValueOnce([{ id: 10, parentTaskId: null }])
        .mockResolvedValueOnce([])
    };
    const assigneeRepository = {
      findAll: jest.fn().mockResolvedValue([{ taskId: 11 }])
    };
    const service = createService(taskRepository, assigneeRepository);

    await service.getByColumn(10, 7, {
      limit: 5,
      offset: 0,
      assigneeIds: [7],
      includeSubtasks: false
    });

    expect(taskRepository.findAll).toHaveBeenNthCalledWith(1, {
      where: {
        columnId: 10,
        parentTaskId: null
      },
      attributes: ['id', 'parentTaskId'],
      raw: true
    });
    expect(assigneeRepository.findAll).toHaveBeenCalledWith({
      where: {
        taskId: { [Op.in]: [10] },
        userId: { [Op.in]: [7] }
      },
      attributes: ['taskId'],
      raw: true
    });
    expect(taskRepository.count).toHaveBeenCalledWith({
      where: {
        columnId: 10,
        parentTaskId: null,
        id: { [Op.in]: [] }
      }
    });
  });
});
