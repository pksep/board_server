import { ActivityEntityType } from '../../activity-events/activity-events.constants';
import { TasksService } from '../tasks.service';

describe('TasksService.getHistory', () => {
  it('проверяет доступ к проекту и читает только его историю задачи', async () => {
    const taskRepository = {
      findByPk: jest.fn().mockResolvedValue({ id: 42, columnId: 10 })
    };
    const columnRepository = {
      findByPk: jest
        .fn()
        .mockResolvedValueOnce({ id: 10, boardId: 20 })
        .mockResolvedValueOnce({ id: 10, board: { projectId: 30 } })
    };
    const boardRepository = {
      findByPk: jest.fn().mockResolvedValue({ id: 20, projectId: 30 })
    };
    const projectAccess = { assertCanRead: jest.fn() };
    const activityEvents = {
      findByEntity: jest.fn().mockResolvedValue({
        items: [{ id: 1 }],
        nextCursor: null
      })
    };
    const service = new TasksService(
      taskRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      columnRepository as any,
      boardRepository as any,
      {} as any,
      {} as any,
      {} as any,
      projectAccess as any,
      activityEvents as any
    );

    const result = await service.getHistory(42, 7, {
      limit: 25,
      beforeId: 100
    });

    expect(projectAccess.assertCanRead).toHaveBeenCalledWith(30, 7, undefined);
    expect(activityEvents.findByEntity).toHaveBeenCalledWith({
      projectId: 30,
      entityType: ActivityEntityType.Task,
      entityId: '42',
      limit: 25,
      beforeId: 100
    });
    expect(result.items).toEqual([{ id: 1 }]);
  });
});
