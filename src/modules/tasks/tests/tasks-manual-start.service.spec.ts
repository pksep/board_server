import { TasksService } from '../tasks.service';

describe('manual task start and required readiness', () => {
  const originalStart = new Date('2026-11-19T05:00:00Z');
  const required = new Date('2026-11-19T06:00:00Z');
  const manual = '2026-11-20T06:00:00Z';

  it.each([
    { denied: false, dto: { startDate: manual }, valid: true },
    { denied: true, dto: { startDate: manual }, valid: false },
    { denied: false, dto: { dueDate: '2026-11-18T06:00:00Z' }, valid: false },
    {
      denied: false,
      dto: { startDate: manual, dueDate: required.toISOString() },
      valid: false
    }
  ])(
    'preserves permissions, required date validation and transaction: %j',
    async ({ denied, dto, valid }): Promise<void> => {
      const transaction = {
        commit: jest.fn(),
        rollback: jest.fn(),
        finished: false
      };
      const task = {
        id: 42,
        columnId: 10,
        taskNumber: 5,
        startDate: originalStart,
        dueDate: required,
        save: jest.fn(),
        changed: jest.fn()
      };
      const access = jest.fn().mockResolvedValue(task);
      const permission = jest.fn();
      if (denied) permission.mockRejectedValue(new Error('forbidden'));
      const history = {
        buildChanges: jest.fn().mockReturnValue([
          {
            field: 'startDate',
            before: originalStart.toISOString(),
            after: new Date(manual).toISOString()
          }
        ]),
        create: jest.fn()
      };
      const broadcast = jest.fn();
      const service: TasksService = Object.assign(
        Object.create(TasksService.prototype),
        {
          sequelize: { transaction: jest.fn().mockResolvedValue(transaction) },
          assertTaskAccess: access,
          assertCanEditTaskFields: permission,
          getProjectIdByColumnId: jest.fn().mockResolvedValue(30),
          activityEvents: history,
          wsGateway: { emitTaskUpdated: broadcast },
          getById: jest.fn().mockResolvedValue(task),
          getBoardIdByColumnId: jest.fn().mockResolvedValue(20),
          logger: { error: jest.fn() }
        }
      );
      if (!valid) {
        await expect(service.update(42, dto, 7)).rejects.toThrow();
        expect(task.save).not.toHaveBeenCalled();
        expect(transaction.rollback).toHaveBeenCalledTimes(1);
        expect(history.create).not.toHaveBeenCalled();
        expect(broadcast).not.toHaveBeenCalled();
        expect(transaction.commit).not.toHaveBeenCalled();
        expect(task.startDate).toEqual(originalStart);
        expect(task.dueDate).toEqual(required);
        return;
      }
      await service.update(42, dto, 7);
      expect(permission).toHaveBeenCalledWith(
        task,
        { startDate: manual },
        7,
        transaction
      );
      expect(task.startDate).toBe(manual);
      expect(task.dueDate).toEqual(required);
      expect(task.save).toHaveBeenCalledWith({ transaction });
      expect(history.create).toHaveBeenCalledTimes(1);
      expect(transaction.commit).toHaveBeenCalledTimes(1);
      expect(broadcast).toHaveBeenCalledWith(20, task);
    }
  );
});
