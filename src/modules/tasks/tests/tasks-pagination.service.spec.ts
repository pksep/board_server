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
          { id: 10, parentTaskId: null, priority: 'low' },
          { id: 12, parentTaskId: null, priority: 'high' }
        ])
        .mockResolvedValueOnce([{ id: 11, parentTaskId: 10, priority: 'high' }])
        .mockResolvedValueOnce([])
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
        parentTaskId: null
      },
      attributes: ['id', 'parentTaskId', 'priority'],
      raw: true
    });
    expect(assigneeRepository.findAll).toHaveBeenCalledWith({
      where: {
        taskId: { [Op.in]: [12, 11] },
        userId: { [Op.in]: [7] }
      },
      attributes: ['taskId'],
      raw: true
    });
    expect(taskTagRepository.findAll).toHaveBeenCalledWith({
      where: {
        taskId: { [Op.in]: [12, 11] },
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

  it('возвращает корневую карточку при совпадении вложенной подзадачи', async () => {
    const root = { id: 10, columnId: 10, order: 0 };
    const taskRepository = {
      count: jest.fn().mockResolvedValue(1),
      findAll: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 10, parentTaskId: null, priority: 'low' }
        ])
        .mockResolvedValueOnce([
          { id: 11, parentTaskId: 10, priority: 'medium' }
        ])
        .mockResolvedValueOnce([{ id: 12, parentTaskId: 11, priority: 'high' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([root])
    };
    const assigneeRepository = {
      findAll: jest.fn().mockResolvedValue([{ taskId: 12 }])
    };
    const service = createService(taskRepository, assigneeRepository);

    await expect(
      service.getByColumn(10, 7, {
        limit: 5,
        offset: 0,
        assigneeIds: [7],
        priorities: ['high'],
        includeSubtasks: true
      })
    ).resolves.toEqual({
      items: [root],
      total: 1,
      limit: 5,
      offset: 0,
      hasMore: false
    });
    expect(assigneeRepository.findAll).toHaveBeenCalledWith({
      where: {
        taskId: { [Op.in]: [12] },
        userId: { [Op.in]: [7] }
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

  it('учитывает вложенную подзадачу после переноса в другую колонку', async () => {
    const root = { id: 10, columnId: 10, order: 0 };
    const taskRepository = {
      count: jest.fn().mockResolvedValue(1),
      findAll: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 10, parentTaskId: null, columnId: 10, priority: 'low' }
        ])
        .mockResolvedValueOnce([
          { id: 11, parentTaskId: 10, columnId: 20, priority: 'medium' }
        ])
        .mockResolvedValueOnce([
          { id: 12, parentTaskId: 11, columnId: 20, priority: 'high' }
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([root])
    };
    const assigneeRepository = {
      findAll: jest.fn().mockResolvedValue([{ taskId: 12 }])
    };
    const service = createService(taskRepository, assigneeRepository);

    await expect(
      service.getByColumn(10, 7, {
        limit: 5,
        offset: 0,
        assigneeIds: [7],
        includeSubtasks: true
      })
    ).resolves.toEqual({
      items: [root],
      total: 1,
      limit: 5,
      offset: 0,
      hasMore: false
    });
    expect(taskRepository.findAll).toHaveBeenNthCalledWith(2, {
      where: { parentTaskId: { [Op.in]: [10] } },
      attributes: ['id', 'parentTaskId', 'priority'],
      raw: true
    });
    expect(taskRepository.findAll).toHaveBeenNthCalledWith(3, {
      where: { parentTaskId: { [Op.in]: [11] } },
      attributes: ['id', 'parentTaskId', 'priority'],
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
