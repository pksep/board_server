import { QueryTypes } from 'sequelize';
import { TasksService } from '../tasks.service';

interface ITaskTimeServiceFixture {
  projectAccess: { assertCanRead: jest.Mock };
  service: TasksService;
}

const createRecord = (id: number): Record<string, unknown> => ({
  actorId: 7,
  actorImage: null,
  actorInitial: 'Администратор',
  actorLogin: 'Admin.A.A',
  comment: id === 3 ? 'Проверил результат' : null,
  createdAt: '2026-09-30T10:00:00.000Z',
  durationMinutes: id === 3 ? 80 : 20,
  id,
  taskId: 42,
  userId: 7
});

describe('TasksService task time entries', () => {
  const createService = (sequelize: object): ITaskTimeServiceFixture => {
    const taskRepository = {
      findByPk: jest.fn().mockResolvedValue({ id: 42, columnId: 10 })
    };
    const columnRepository = {
      findByPk: jest.fn().mockResolvedValue({ id: 10, boardId: 20 })
    };
    const boardRepository = {
      findByPk: jest.fn().mockResolvedValue({ id: 20, projectId: 30 })
    };
    const projectAccess = { assertCanRead: jest.fn() };
    const service = new TasksService(
      taskRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      columnRepository as never,
      boardRepository as never,
      sequelize as never,
      {} as never,
      {} as never,
      projectAccess as never,
      {} as never
    );

    return { projectAccess, service };
  };

  it('возвращает записи времени от новых к старым с cursor-пагинацией', async () => {
    const query = jest
      .fn()
      .mockResolvedValue([createRecord(3), createRecord(2), createRecord(1)]);
    const { projectAccess, service } = createService({ query });

    const result = await service.getTimeEntries(42, 7, {
      beforeId: 10,
      limit: 2
    });

    expect(projectAccess.assertCanRead).toHaveBeenCalledWith(30, 7, undefined);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('entry.id < :beforeId'),
      expect.objectContaining({
        replacements: {
          taskId: 42,
          beforeId: 10,
          limit: 3
        },
        type: QueryTypes.SELECT
      })
    );
    expect(result.items.map(item => item.id)).toEqual([3, 2]);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        durationMinutes: 80,
        comment: 'Проверил результат',
        actor: expect.objectContaining({ login: 'Admin.A.A' })
      })
    );
    expect(result.nextCursor).toBe(2);
  });

  it('сохраняет длительность и необязательный комментарий текущего пользователя', async () => {
    const transaction = {
      commit: jest.fn(),
      rollback: jest.fn()
    };
    const query = jest.fn().mockResolvedValue([createRecord(3)]);
    const { projectAccess, service } = createService({
      query,
      transaction: jest.fn().mockResolvedValue(transaction)
    });

    const result = await service.createTimeEntry(
      42,
      { durationMinutes: 80, comment: '  Проверил результат  ' },
      7
    );

    expect(projectAccess.assertCanRead).toHaveBeenCalledWith(
      30,
      7,
      transaction
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO task_time_entries'),
      expect.objectContaining({
        replacements: {
          taskId: 42,
          userId: 7,
          durationMinutes: 80,
          comment: 'Проверил результат'
        },
        transaction,
        type: QueryTypes.SELECT
      })
    );
    expect(result.durationMinutes).toBe(80);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });
});
