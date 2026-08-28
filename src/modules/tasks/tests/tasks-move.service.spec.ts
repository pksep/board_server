import { TasksService } from '../tasks.service';

function createSubtaskMoveFixture(targetBoardId = 20) {
  const transaction = {
    LOCK: { UPDATE: 'UPDATE' },
    commit: jest.fn(),
    rollback: jest.fn()
  };
  const subtask = {
    id: 2,
    taskNumber: 6,
    columnId: 10,
    parentTaskId: 1,
    order: 0,
    save: jest.fn().mockResolvedValue(undefined)
  };
  const taskRepository = {
    findByPk: jest.fn().mockResolvedValue(subtask),
    findAll: jest.fn()
  };
  const columnRepository = {
    findByPk: jest.fn(async (id: number) => ({
      id,
      boardId: id === 10 ? 20 : targetBoardId
    }))
  };
  const boardRepository = {
    findByPk: jest.fn(async (id: number) => ({ id, projectId: 1 }))
  };
  const wsGateway = {
    emitTaskRelocated: jest.fn(),
    emitTaskMoved: jest.fn()
  };
  const projectAccess = {
    assertCanRead: jest.fn(),
    assertAssigneesBelongToProject: jest.fn()
  };
  const activityEvents = {
    buildChanges: jest.fn(fields =>
      Object.entries(fields)
        .filter(
          ([, value]: any) =>
            JSON.stringify(value.before) !== JSON.stringify(value.after)
        )
        .map(([field, value]: any) => ({
          field,
          before: value.before,
          after: value.after
        }))
    ),
    create: jest.fn()
  };
  const service = new TasksService(
    taskRepository as any,
    { findAll: jest.fn() } as any,
    { destroy: jest.fn() } as any,
    {} as any,
    { findByPk: jest.fn() } as any,
    columnRepository as any,
    boardRepository as any,
    {
      transaction: jest.fn().mockResolvedValue(transaction),
      query: jest.fn()
    } as any,
    wsGateway as any,
    {} as any,
    projectAccess as any,
    activityEvents as any
  );

  return {
    activityEvents,
    service,
    subtask,
    taskRepository,
    transaction,
    wsGateway
  };
}

describe('TasksService.move', () => {
  it('атомарно переносит и перенумеровывает родителя с подзадачами', async () => {
    const transaction = {
      LOCK: { UPDATE: 'UPDATE' },
      commit: jest.fn(),
      rollback: jest.fn()
    };
    const root = {
      id: 1,
      taskNumber: 5,
      columnId: 10,
      parentTaskId: null,
      order: 3,
      save: jest.fn().mockResolvedValue(undefined),
      update: jest.fn()
    };
    const child = {
      id: 2,
      taskNumber: 6,
      columnId: 10,
      parentTaskId: 1,
      order: 0,
      save: jest.fn().mockResolvedValue(undefined),
      update: jest.fn()
    };
    const responseTask = { ...root, subtasks: [child] };

    const taskRepository = {
      findByPk: jest.fn(async (_id: number, options: any) =>
        options?.include ? responseTask : root
      ),
      findAll: jest.fn(async (options: any) => {
        const parentIds = options.where?.parentTaskId;
        if (Array.isArray(parentIds)) {
          return parentIds.includes(root.id) ? [child] : [];
        }
        return [];
      })
    };
    const taskTagRepository = { destroy: jest.fn() };
    const assigneeRepository = {
      findAll: jest.fn().mockResolvedValue([{ userId: 7 }])
    };
    const targetProject = {
      id: 2,
      taskCounter: 100,
      save: jest.fn().mockResolvedValue(undefined)
    };
    const projectRepository = {
      findByPk: jest.fn().mockResolvedValue(targetProject)
    };
    const columnRepository = {
      findByPk: jest.fn(async (id: number) => ({
        id,
        boardId: id === 10 ? 20 : 40
      }))
    };
    const boardRepository = {
      findByPk: jest.fn(async (id: number) => ({
        id,
        projectId: id === 20 ? 1 : 2
      }))
    };
    const wsGateway = {
      emitTaskRelocated: jest.fn(),
      emitTaskMoved: jest.fn()
    };
    const projectAccess = {
      assertCanRead: jest.fn(),
      assertAssigneesBelongToProject: jest.fn()
    };
    const activityEvents = {
      buildChanges: jest.fn(fields =>
        Object.entries(fields)
          .filter(
            ([, value]: any) =>
              JSON.stringify(value.before) !== JSON.stringify(value.after)
          )
          .map(([field, value]: any) => ({
            field,
            before: value.before,
            after: value.after
          }))
      ),
      create: jest.fn()
    };
    const service = new TasksService(
      taskRepository as any,
      assigneeRepository as any,
      taskTagRepository as any,
      {} as any,
      projectRepository as any,
      columnRepository as any,
      boardRepository as any,
      {
        transaction: jest.fn().mockResolvedValue(transaction),
        query: jest.fn().mockResolvedValue([{ maxTaskNumber: 100 }])
      } as any,
      wsGateway as any,
      {} as any,
      projectAccess as any,
      activityEvents as any
    );

    const result = await service.move(1, { columnId: 30, order: 0 }, 7);

    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(root.columnId).toBe(30);
    expect(child.columnId).toBe(30);
    expect(root.taskNumber).toBe(101);
    expect(child.taskNumber).toBe(102);
    expect(targetProject.taskCounter).toBe(102);
    expect(taskTagRepository.destroy).toHaveBeenCalledWith({
      where: { taskId: [1, 2] },
      transaction
    });
    expect(projectAccess.assertAssigneesBelongToProject).toHaveBeenCalledWith(
      2,
      [7],
      transaction
    );
    expect(wsGateway.emitTaskRelocated).toHaveBeenCalledWith(
      20,
      40,
      expect.objectContaining({ taskIds: [1, 2], toProjectId: 2 })
    );
    expect(activityEvents.create).toHaveBeenCalledTimes(4);
    expect(activityEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 2,
        entityId: '1',
        actorUserId: 7,
        metadata: expect.objectContaining({ direction: 'in' })
      }),
      { transaction }
    );
    expect(result).toBe(responseTask);
  });

  it('не меняет статусы подзадач при смене статуса родительской задачи', async () => {
    const transaction = {
      LOCK: { UPDATE: 'UPDATE' },
      commit: jest.fn(),
      rollback: jest.fn()
    };
    const root = {
      id: 1,
      taskNumber: 5,
      columnId: 10,
      parentTaskId: null,
      order: 0,
      save: jest.fn().mockResolvedValue(undefined),
      update: jest.fn()
    };
    const child = {
      id: 2,
      taskNumber: 6,
      columnId: 10,
      parentTaskId: 1,
      order: 0,
      save: jest.fn().mockResolvedValue(undefined)
    };
    const responseTask = { ...root, subtasks: [child] };
    const taskRepository = {
      findByPk: jest.fn(async (_id: number, options: any) =>
        options?.include ? responseTask : root
      ),
      findAll: jest.fn(async () => [])
    };
    const columnRepository = {
      findByPk: jest.fn(async (id: number) => ({ id, boardId: 20 }))
    };
    const boardRepository = {
      findByPk: jest.fn(async (id: number) => ({ id, projectId: 1 }))
    };
    const wsGateway = {
      emitTaskRelocated: jest.fn(),
      emitTaskMoved: jest.fn()
    };
    const activityEvents = {
      buildChanges: jest.fn(fields =>
        Object.entries(fields)
          .filter(
            ([, value]: any) =>
              JSON.stringify(value.before) !== JSON.stringify(value.after)
          )
          .map(([field, value]: any) => ({
            field,
            before: value.before,
            after: value.after
          }))
      ),
      create: jest.fn()
    };
    const service = new TasksService(
      taskRepository as any,
      { findAll: jest.fn() } as any,
      { destroy: jest.fn() } as any,
      {} as any,
      {} as any,
      columnRepository as any,
      boardRepository as any,
      {
        transaction: jest.fn().mockResolvedValue(transaction),
        query: jest.fn()
      } as any,
      wsGateway as any,
      {} as any,
      {
        assertCanRead: jest.fn(),
        assertAssigneesBelongToProject: jest.fn()
      } as any,
      activityEvents as any
    );

    await service.move(root.id, { columnId: 30, order: 0 }, 7);

    expect(root.columnId).toBe(30);
    expect(child.columnId).toBe(10);
    expect(child.save).not.toHaveBeenCalled();
    expect(taskRepository.findAll).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ parentTaskId: [root.id] })
      })
    );
    expect(activityEvents.create).toHaveBeenCalledTimes(1);
    expect(wsGateway.emitTaskMoved).toHaveBeenCalledWith(20, {
      taskId: root.id,
      taskIds: [root.id],
      fromColumnId: 10,
      toColumnId: 30,
      order: 0
    });
    expect(wsGateway.emitTaskRelocated).not.toHaveBeenCalled();
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('перемещает только подзадачу между колонками текущей доски', async () => {
    const fixture = createSubtaskMoveFixture();

    const result = await fixture.service.move(
      fixture.subtask.id,
      { columnId: 30, order: 0 },
      7
    );

    expect(result).toBe(fixture.subtask);
    expect(fixture.subtask.columnId).toBe(30);
    expect(fixture.subtask.order).toBe(0);
    expect(fixture.subtask.save).toHaveBeenCalledWith({
      transaction: fixture.transaction
    });
    expect(fixture.taskRepository.findAll).not.toHaveBeenCalled();
    expect(fixture.transaction.commit).toHaveBeenCalledTimes(1);
    expect(fixture.transaction.rollback).not.toHaveBeenCalled();
    expect(fixture.wsGateway.emitTaskMoved).toHaveBeenCalledWith(20, {
      taskId: 2,
      taskIds: [fixture.subtask.id],
      fromColumnId: 10,
      toColumnId: 30,
      order: 0
    });
    expect(fixture.wsGateway.emitTaskRelocated).not.toHaveBeenCalled();
    expect(fixture.activityEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: '2',
        metadata: expect.objectContaining({
          rootTaskId: 1,
          hierarchySize: 1,
          direction: 'within'
        })
      }),
      { transaction: fixture.transaction }
    );
  });

  it('не позволяет перенести подзадачу на другую доску', async () => {
    const fixture = createSubtaskMoveFixture(40);

    await expect(
      fixture.service.move(fixture.subtask.id, { columnId: 30, order: 0 }, 7)
    ).rejects.toThrow(
      'Подзадачу можно перемещать только между колонками текущей доски'
    );

    expect(fixture.subtask.columnId).toBe(10);
    expect(fixture.subtask.save).not.toHaveBeenCalled();
    expect(fixture.transaction.commit).not.toHaveBeenCalled();
    expect(fixture.transaction.rollback).toHaveBeenCalledTimes(1);
    expect(fixture.wsGateway.emitTaskMoved).not.toHaveBeenCalled();
    expect(fixture.activityEvents.create).not.toHaveBeenCalled();
  });
});
