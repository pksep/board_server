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
      startDate: new Date('2026-09-29T00:00:00.000Z'),
      customAttributeValues: {},
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
      taskAttributeDefinitions: [
        { id: 'approved', name: 'Подтверждено', type: 'boolean' },
        { id: 'reviewers', name: 'Проверяющие', type: 'participants' },
        { id: 'review-date', name: 'Дата проверки', type: 'date' },
        { id: 'note', name: 'Примечание', type: 'text' },
        { id: 'estimate', name: 'Оценка', type: 'number' }
      ],
      save: jest.fn().mockResolvedValue(undefined)
    };
    const projectRepository = {
      findByPk: jest.fn().mockResolvedValue(project)
    };
    const projectAccess = {
      assertCanRead: jest.fn(),
      assertAssigneesBelongToProject: jest.fn()
    };
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

    await service.createSubtask(
      10,
      {
        title: subtask.title,
        startDate: '2026-09-29T00:00:00.000Z',
        customAttributeValues: {
          approved: true,
          reviewers: [7, 8],
          'review-date': '2026-10-01',
          note: 'Нужна повторная проверка',
          estimate: 12
        }
      },
      7
    );

    expect(subtask.taskNumber).toBe(6);
    expect(project.taskCounter).toBe(6);
    expect(subtask.customAttributeValues).toEqual({
      approved: true,
      reviewers: [7, 8],
      'review-date': '2026-10-01T00:00:00.000Z',
      note: 'Нужна повторная проверка',
      estimate: 12
    });
    expect(projectAccess.assertAssigneesBelongToProject).toHaveBeenCalledWith(
      30,
      [7, 8],
      transaction
    );
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
