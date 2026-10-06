import { Op } from 'sequelize';
import { TasksService } from '../tasks.service';

describe('TasksService paginated column loading', () => {
  /** Создаёт сервис с изолированными репозиториями без обращения к рабочей базе. */
  const createService = (
    taskRepository: Record<string, jest.Mock>,
    assigneeRepository: Record<string, jest.Mock> = {},
    taskTagRepository: Record<string, jest.Mock> = {}
  ): TasksService => {
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

  it('отбирает задачи любого выбранного создателя до пагинации', async () => {
    const tasks = [
      { id: 10, parentTaskId: null, createdById: 7 },
      { id: 12, parentTaskId: null, createdById: 15 },
      { id: 13, parentTaskId: null, createdById: 22 }
    ];
    const taskRepository = {
      count: jest.fn().mockResolvedValue(2),
      findAll: jest
        .fn()
        .mockResolvedValueOnce(tasks)
        .mockResolvedValueOnce([tasks[1]])
    };

    const result = await createService(taskRepository).getByColumn(10, 7, {
      creatorIds: [7, 15],
      limit: 1,
      offset: 1
    });

    expect(result).toEqual({
      items: [tasks[1]],
      total: 2,
      limit: 1,
      offset: 1,
      hasMore: false
    });
    expect(taskRepository.findAll).toHaveBeenNthCalledWith(1, {
      where: { columnId: 10, parentTaskId: null },
      attributes: ['id', 'parentTaskId', 'createdById'],
      raw: true
    });
    expect(taskRepository.count).toHaveBeenCalledWith({
      where: { columnId: 10, parentTaskId: null, id: { [Op.in]: [10, 12] } }
    });
    expect(taskRepository.findAll).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ limit: 1, offset: 1 })
    );
  });

  it('пересекает создателей с исполнителями, тегами и приоритетами одной задачи', async () => {
    const tasks = [
      { id: 10, parentTaskId: null, createdById: 7, priority: 'high' },
      { id: 12, parentTaskId: null, createdById: 15, priority: 'high' },
      { id: 13, parentTaskId: null, createdById: 22, priority: 'high' }
    ];
    const taskRepository = {
      count: jest.fn().mockResolvedValue(1),
      findAll: jest
        .fn()
        .mockResolvedValueOnce(tasks)
        .mockResolvedValueOnce([tasks[1]])
    };
    const assigneeRepository = {
      findAll: jest.fn().mockResolvedValue([{ taskId: 12 }, { taskId: 13 }])
    };
    const taskTagRepository = {
      findAll: jest.fn().mockResolvedValue([{ taskId: 12 }])
    };

    await createService(
      taskRepository,
      assigneeRepository,
      taskTagRepository
    ).getByColumn(10, 7, {
      creatorIds: [7, 15],
      assigneeIds: [30],
      priorities: ['high'],
      tagIds: [3],
      limit: 5
    });

    expect(taskRepository.findAll).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          columnId: 10,
          parentTaskId: null,
          priority: { [Op.in]: ['high'] }
        }
      })
    );
    expect(assigneeRepository.findAll).toHaveBeenCalledWith({
      where: { taskId: { [Op.in]: [10, 12] }, userId: { [Op.in]: [30] } },
      attributes: ['taskId'],
      raw: true
    });
    expect(taskRepository.count).toHaveBeenCalledWith({
      where: { columnId: 10, parentTaskId: null, id: { [Op.in]: [12] } }
    });
  });

  it('учитывает создателя вложенной подзадачи в прежней группировке по корням', async () => {
    const root = { id: 10, parentTaskId: null, createdById: 7 };
    const taskRepository = {
      count: jest.fn().mockResolvedValue(1),
      findAll: jest
        .fn()
        .mockResolvedValueOnce([root])
        .mockResolvedValueOnce([{ id: 11, parentTaskId: 10, createdById: 15 }])
        .mockResolvedValueOnce([{ id: 12, parentTaskId: 11, createdById: 22 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([root])
    };

    await createService(taskRepository).getByColumn(10, 7, {
      creatorIds: [22],
      includeSubtasks: true,
      limit: 5
    });

    expect(taskRepository.count).toHaveBeenCalledWith({
      where: { columnId: 10, parentTaskId: null, id: { [Op.in]: [10] } }
    });
  });

  it('в плоском режиме использует создателя самой подзадачи, а не родителя', async () => {
    const child = { id: 11, parentTaskId: 10, createdById: 15 };
    const taskRepository = {
      count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
      findAll: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 10, parentTaskId: null, createdById: 7 },
          child
        ])
        .mockResolvedValueOnce([child])
    };

    const result = await createService(taskRepository).getByColumn(10, 7, {
      creatorIds: [15],
      includeSubtasks: true,
      flatSubtasks: true,
      limit: 5
    });

    expect(result).toEqual(
      expect.objectContaining({ items: [child], total: 1, rootTotal: 0 })
    );
    expect(taskRepository.count).toHaveBeenCalledWith({
      where: { columnId: 10, id: { [Op.in]: [11] } }
    });
  });

  it('не объединяет создателя родителя с исполнителем другой подзадачи', async () => {
    const taskRepository = {
      count: jest.fn().mockResolvedValue(0),
      findAll: jest
        .fn()
        .mockResolvedValueOnce([{ id: 10, parentTaskId: null, createdById: 7 }])
        .mockResolvedValueOnce([{ id: 11, parentTaskId: 10, createdById: 15 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
    };
    const assigneeRepository = {
      findAll: jest.fn().mockResolvedValue([{ taskId: 11 }])
    };

    const result = await createService(
      taskRepository,
      assigneeRepository
    ).getByColumn(10, 7, {
      creatorIds: [7],
      assigneeIds: [30],
      includeSubtasks: true,
      limit: 5
    });

    expect(result).toEqual(expect.objectContaining({ items: [], total: 0 }));
    expect(assigneeRepository.findAll).toHaveBeenCalledWith({
      where: { taskId: { [Op.in]: [10] }, userId: { [Op.in]: [30] } },
      attributes: ['taskId'],
      raw: true
    });
  });

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

  it('пагинирует подзадачи в их колонке независимо от наличия загруженного родителя', async () => {
    const child = { id: 11, parentTaskId: 99, columnId: 10, order: 0 };
    const taskRepository = {
      count: jest.fn().mockResolvedValueOnce(7).mockResolvedValueOnce(0),
      findAll: jest.fn().mockResolvedValue([child])
    };
    const service = createService(taskRepository);
    await expect(
      service.getByColumn(10, 7, {
        limit: 1,
        offset: 3,
        includeSubtasks: true,
        flatSubtasks: true
      })
    ).resolves.toEqual({
      items: [child],
      total: 7,
      rootTotal: 0,
      limit: 1,
      offset: 3,
      hasMore: true
    });
    expect(taskRepository.count).toHaveBeenCalledWith({
      where: { columnId: 10 }
    });
    expect(taskRepository.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { columnId: 10 },
        limit: 1,
        offset: 3
      })
    );
  });

  it('в плоском режиме пересекает поиск и фильтры на самой подзадаче', async () => {
    const child = { id: 11, parentTaskId: 99, columnId: 10, priority: 'high' };
    const taskRepository = {
      count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
      findAll: jest
        .fn()
        .mockResolvedValueOnce([child])
        .mockResolvedValueOnce([
          child,
          { id: 12, parentTaskId: null, priority: 'high' }
        ])
        .mockResolvedValueOnce([child])
    };
    const service = createService(
      taskRepository,
      {
        findAll: jest.fn().mockResolvedValue([{ taskId: 11 }, { taskId: 12 }])
      },
      { findAll: jest.fn().mockResolvedValue([{ taskId: 11 }]) }
    );
    await expect(
      service.getByColumn(10, 7, {
        limit: 5,
        includeSubtasks: true,
        flatSubtasks: true,
        search: 'макет',
        priorities: ['high'],
        assigneeIds: [7],
        tagIds: [3]
      })
    ).resolves.toEqual({
      items: [child],
      total: 1,
      rootTotal: 0,
      limit: 5,
      offset: 0,
      hasMore: false
    });
    expect(taskRepository.count).toHaveBeenCalledWith({
      where: { columnId: 10, id: { [Op.in]: [11] } }
    });
    expect(taskRepository.findAll).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { columnId: 10, priority: { [Op.in]: ['high'] } }
      })
    );
  });

  it('не включает плоский режим без явно включённого показа подзадач', async () => {
    const taskRepository = {
      count: jest.fn().mockResolvedValue(0),
      findAll: jest.fn().mockResolvedValue([])
    };
    await createService(taskRepository).getByColumn(10, 7, {
      limit: 5,
      flatSubtasks: true,
      includeSubtasks: false
    });
    expect(taskRepository.count).toHaveBeenCalledWith({
      where: { columnId: 10, parentTaskId: null }
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
