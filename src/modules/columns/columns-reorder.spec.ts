import { ColumnsService } from './columns.service';

describe('ColumnsService.reorder', () => {
  it('updates once, keeps the last duplicate position and emits after commit', async () => {
    const calls: string[] = [];
    const transaction = {
      commit: jest.fn(async () => {
        calls.push('commit');
      }),
      rollback: jest.fn()
    };
    const sequelize = {
      transaction: jest.fn().mockResolvedValue(transaction),
      query: jest.fn(async () => {
        calls.push('query');
      })
    };
    const gateway = {
      emitColumnReordered: jest.fn(() => {
        calls.push('event');
      })
    };
    const service = new ColumnsService(
      {} as never,
      { findByPk: jest.fn().mockResolvedValue({ projectId: 7 }) } as never,
      sequelize as never,
      gateway as never,
      { assertCanRead: jest.fn() } as never
    );

    await service.reorder(5, { ids: [10, 11, 10] }, 42);

    expect(sequelize.query).toHaveBeenCalledWith(
      expect.stringContaining('col."deletedAt" IS NULL'),
      {
        bind: {
          ids: [10, 11],
          orders: [2, 1],
          boardId: 5,
          updatedAt: expect.any(Date)
        },
        transaction
      }
    );
    expect(calls).toEqual(['query', 'commit', 'event']);
    expect(gateway.emitColumnReordered).toHaveBeenCalledWith(5, [10, 11, 10]);
  });
});
