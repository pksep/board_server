import { TasksService } from '../tasks.service';

describe('TasksService order persistence', () => {
  it('batches changed normal rows, leaves unchanged rows and preserves legacy hooks', async () => {
    const query = jest.fn();
    const service = Object.create(TasksService.prototype) as TasksService;
    Object.assign(service, { sequelize: { query } });
    const transaction = {};
    const normal = { id: 1, order: 9, controllerIds: [42], update: jest.fn() };
    const unchanged = { id: 2, order: 1, controllerIds: [], update: jest.fn() };
    const legacy = { id: 3, order: 5, controllerIds: [], update: jest.fn() };

    await service['persistTaskOrders'](
      new Map([
        [normal, 0],
        [unchanged, 1],
        [legacy, 2]
      ]) as never,
      transaction as never
    );

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('task."deletedAt" IS NULL'),
      {
        bind: { ids: [1], orders: [0], updatedAt: expect.any(Date) },
        transaction
      }
    );
    expect(normal.order).toBe(0);
    expect(normal.update).not.toHaveBeenCalled();
    expect(unchanged.update).not.toHaveBeenCalled();
    expect(legacy.update).toHaveBeenCalledWith({ order: 2 }, { transaction });
  });

  it('does not write an already normalized column', async () => {
    const query = jest.fn();
    const service = Object.create(TasksService.prototype) as TasksService;
    Object.assign(service, { sequelize: { query } });
    const task = { id: 1, order: 0, controllerIds: [42] };

    await service['persistTaskOrders'](
      new Map([[task, 0]]) as never,
      {} as never
    );

    expect(query).not.toHaveBeenCalled();
  });
});
