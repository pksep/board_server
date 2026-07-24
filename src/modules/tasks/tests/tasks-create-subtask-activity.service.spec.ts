import { ActivityActionType } from '../../activity-events/activity-events.constants';
import { TasksService } from '../tasks.service';

describe('TasksService.createSubtask activity', () => {
  it('фиксирует создание в историях подзадачи и родительской задачи', async () => {
    const transaction = {
      LOCK: { UPDATE: 'UPDATE' },
      commit: jest.fn(),
      rollback: jest.fn(),
      finished: false
    };
    const parent = {
      id: 10,
      columnId: 5
    };
    const subtask = {
      id: 11,
      taskNumber: 0,
      title: 'Новая подзадача',
      description: '',
      priority: '',
      approvalStatus: '',
      dueDate: null,
      columnId: 5,
      parentTaskId: 10
    };
    const taskRepository = {
      findByPk: jest.fn().mockResolvedValue(parent),
      create: jest.fn(async task => Object.assign(subtask, task))
    };
    const columnRepository = {
      findByPk: jest.fn(async (_id: number, options: any) =>
        options?.include
          ? { id: 5, board: { projectId: 30 } }
          : { id: 5, boardId: 20 }
      )
    };
    const project = {
      id: 30,
      taskCounter: 4,
      save: jest.fn().mockResolvedValue(undefined)
    };
    const projectRepository = {
      findByPk: jest.fn().mockResolvedValue(project)
    };
    const projectAccess = { assertCanRead: jest.fn() };
    const activityEvents = {
      buildChanges: jest.fn().mockReturnValue([
        {
          field: 'title',
          before: null,
          after: subtask.title
        }
      ]),
      create: jest.fn()
    };
    const wsGateway = { emitTaskCreated: jest.fn() };
    const service = new TasksService(
      taskRepository as any,
      {} as any,
      {} as any,
      {} as any,
      projectRepository as any,
      columnRepository as any,
      {} as any,
      {
        transaction: jest.fn().mockResolvedValue(transaction),
        query: jest.fn().mockResolvedValue([{ maxTaskNumber: 5 }])
      } as any,
      wsGateway as any,
      {} as any,
      projectAccess as any,
      activityEvents as any
    );
    jest.spyOn(service, 'getById').mockResolvedValue(subtask as any);

    await service.createSubtask(10, { title: subtask.title }, 7);

    expect(subtask.taskNumber).toBe(6);
    expect(project.taskCounter).toBe(6);
    expect(projectRepository.findByPk).toHaveBeenCalledWith(30, {
      transaction,
      lock: 'UPDATE'
    });
    expect(activityEvents.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        projectId: 30,
        entityId: '11',
        actionType: ActivityActionType.Created,
        actorUserId: 7
      }),
      { transaction }
    );
    expect(activityEvents.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        projectId: 30,
        entityId: '10',
        actionType: ActivityActionType.Updated,
        actorUserId: 7,
        changes: [],
        metadata: {
          eventType: 'subtask_created',
          subtaskId: 11,
          subtaskTitle: 'Новая подзадача',
          taskNumber: 6
        }
      }),
      { transaction }
    );
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });
});
