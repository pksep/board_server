import { TasksService } from '../tasks.service';

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
    const projectAccess = { assertCanRead: jest.fn() };
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
      {} as any,
      taskTagRepository as any,
      {} as any,
      projectRepository as any,
      columnRepository as any,
      boardRepository as any,
      { transaction: jest.fn().mockResolvedValue(transaction) } as any,
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
});
