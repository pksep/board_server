import { UserSyncConsumer } from '../user-sync.consumer';
import { UsersService } from '../users.service';
import { IS_PUBLIC_KEY } from '../../auth/public.decorator';

describe('ERP user availability', () => {
  it('does not require browser cookies for authenticated RabbitMQ messages', () => {
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        UserSyncConsumer.prototype.handleUserEvent
      )
    ).toBe(true);
  });
  const user = {
    id: 12,
    erpId: '81',
    ban: false,
    login: 'before',
    save: jest.fn()
  };
  const repository = { findOne: jest.fn().mockResolvedValue(user) };
  const assignees = { destroy: jest.fn() };
  const gateway = { emitUserAvailabilityChanged: jest.fn() };
  let afterCommit: () => void;
  const transaction = {
    afterCommit: jest.fn(callback => {
      afterCommit = callback;
    })
  };
  const sequelize = {
    transaction: jest.fn(async callback => {
      await callback(transaction);
      afterCommit();
    })
  };
  const service = new UsersService(
    {} as any,
    repository as any,
    assignees as any,
    gateway as any,
    sequelize as any,
    {} as any
  );
  const consumer = new UserSyncConsumer(
    repository as any,
    sequelize as any,
    service
  );

  beforeEach(() => {
    jest.clearAllMocks();
    user.ban = false;
    user.login = 'before';
    user.save.mockResolvedValue(user);
    assignees.destroy.mockResolvedValue(3);
    afterCommit = () => undefined;
  });

  it.each([false, true])(
    'accepts the ERP ban event with NestJS envelope=%s',
    async wrapped => {
      const data = { entity: { id: 81, banned: true } };
      await consumer.handleUserEvent(
        wrapped ? { pattern: 'user.ban', data } : data,
        { fields: { routingKey: 'user.ban' } }
      );
      expect(user.ban).toBe(true);
      expect(user.save).toHaveBeenCalledWith({ transaction });
      expect(assignees.destroy).toHaveBeenCalledWith({
        where: { userId: 12 },
        transaction
      });
      expect(gateway.emitUserAvailabilityChanged).toHaveBeenCalledWith(
        12,
        true
      );
    }
  );

  it('publishes availability only after commit', async () => {
    user.ban = true;
    await service.saveUserAvailability(user as any, transaction as any);
    expect(gateway.emitUserAvailabilityChanged).not.toHaveBeenCalled();
    afterCommit();
    expect(gateway.emitUserAvailabilityChanged).toHaveBeenCalledTimes(1);
  });

  it('unbans without restoring old assignments', async () => {
    user.ban = true;
    await consumer.handleUserEvent(
      { data: { entity: { id: 81, banned: false } } },
      { fields: { routingKey: 'user.ban' } }
    );
    expect(user.ban).toBe(false);
    expect(assignees.destroy).not.toHaveBeenCalled();
  });

  it('accepts the current changedFields contract and archives through the same transaction', async () => {
    await consumer.handleUserEvent(
      {
        data: {
          entity: {
            id: 81,
            changedFields: [
              { fieldName: 'ban', currentValue: true },
              { fieldName: 'login', currentValue: 'after' }
            ]
          }
        }
      },
      { fields: { routingKey: 'user.change' } }
    );
    expect(user.login).toBe('after');
    expect(assignees.destroy).toHaveBeenCalledTimes(1);
  });

  it('does not acknowledge failed cleanup as success', async () => {
    assignees.destroy.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(
      consumer.handleUserEvent(
        { data: { entity: { id: 81, banned: true } } },
        { fields: { routingKey: 'user.ban' } }
      )
    ).rejects.toThrow('database unavailable');
    expect(gateway.emitUserAvailabilityChanged).not.toHaveBeenCalled();
  });
});
