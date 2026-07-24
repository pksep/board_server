import { ActivityActionType } from '../../activity-events/activity-events.constants';
import { TasksService } from '../tasks.service';

describe('TasksService.update activity', () => {
  it('фиксирует field diff без ложного изменения пустого описания', async () => {
    const transaction = {
      commit: jest.fn(),
      rollback: jest.fn()
    };
    const task = {
      id: 42,
      taskNumber: 12,
      title: 'Старое название',
      description: null,
      priority: 'low',
      dueDate: null,
      approvalStatus: '',
      columnId: 10,
      parentTaskId: 8,
      save: jest.fn().mockResolvedValue(undefined)
    };
    const taskRepository = {
      findByPk: jest.fn().mockResolvedValue(task)
    };
    const assigneeRepository = {
      findAll: jest.fn().mockResolvedValue([{ userId: 2 }]),
      destroy: jest.fn(),
      bulkCreate: jest.fn()
    };
    const tagRepository = {
      findAll: jest.fn().mockResolvedValue([]),
      destroy: jest.fn(),
      bulkCreate: jest.fn()
    };
    const columnRepository = {
      findByPk: jest.fn(async (_id: number, options: any) =>
        options?.include
          ? { id: 10, board: { projectId: 30 } }
          : { id: 10, boardId: 20 }
      )
    };
    const boardRepository = {
      findByPk: jest.fn().mockResolvedValue({ id: 20, projectId: 30 })
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
    const wsGateway = { emitTaskUpdated: jest.fn() };
    const service = new TasksService(
      taskRepository as any,
      assigneeRepository as any,
      tagRepository as any,
      {} as any,
      {} as any,
      columnRepository as any,
      boardRepository as any,
      { transaction: jest.fn().mockResolvedValue(transaction) } as any,
      wsGateway as any,
      {} as any,
      projectAccess as any,
      activityEvents as any
    );

    await service.update(
      42,
      {
        title: 'Новое название',
        description: '<p><br></p>',
        assigneeIds: [3],
        parentTaskId: null
      },
      7
    );

    expect(activityEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 30,
        entityId: '42',
        actionType: ActivityActionType.Updated,
        actorUserId: 7,
        changes: [
          {
            field: 'title',
            before: 'Старое название',
            after: 'Новое название'
          },
          { field: 'parentTaskId', before: 8, after: null },
          { field: 'assigneeIds', before: [2], after: [3] }
        ]
      }),
      { transaction }
    );
    expect(task.parentTaskId).toBeNull();
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });
});
