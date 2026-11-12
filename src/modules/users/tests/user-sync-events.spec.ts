import { UserSyncConsumer } from '../user-sync.consumer';

describe('UserSyncConsumer event compatibility', () => {
  const transaction = {};
  const user = { initial: 'Old', ban: false };
  const repository = { findOne: jest.fn().mockResolvedValue(user) };
  const availability = { saveUserAvailability: jest.fn() };
  const sequelize = {
    transaction: jest.fn(async callback => callback(transaction))
  };
  const consumer = new UserSyncConsumer(
    repository as never,
    sequelize as never,
    availability as never
  );

  beforeEach(() => {
    jest.clearAllMocks();
    user.initial = 'Old';
    user.ban = false;
  });

  it.each(['changeFields', 'changedFields'])(
    'accepts %s in direct or Nest events',
    async fieldName => {
      const data = {
        entity: {
          id: 42,
          [fieldName]: [{ fieldName: 'initials', currentValue: ' New ' }]
        }
      };
      const event =
        fieldName === 'changedFields' ? { pattern: 'user.change', data } : data;

      await consumer.handleUserEvent(event, {
        fields: { routingKey: 'user.change' }
      });

      expect(user.initial).toBe('New');
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { erpId: '42' }
      });
      expect(availability.saveUserAvailability).toHaveBeenCalledWith(
        user,
        transaction
      );
    }
  );

  it.each(['ban', 'banned'])(
    'accepts %s without coercing string flags',
    async flag => {
      await consumer.handleUserEvent(
        { entity: { id: '42', [flag]: true } },
        {
          fields: { routingKey: 'user.ban' }
        }
      );
      expect(user.ban).toBe(true);
    }
  );

  it('rejects the entire malformed diff before reading or mutating a user', async () => {
    await expect(
      consumer.handleUserEvent(
        {
          entity: {
            id: '42',
            changeFields: [{ fieldName: 'initial', currentValue: 'New' }, null]
          }
        },
        { fields: { routingKey: 'user.change' } }
      )
    ).rejects.toThrow('invalid field');
    expect(user.initial).toBe('Old');
    expect(repository.findOne).not.toHaveBeenCalled();
    expect(availability.saveUserAvailability).not.toHaveBeenCalled();
  });

  it('soft deletes via the canonical availability service', async () => {
    await consumer.handleUserEvent(
      { entity: { id: '42' } },
      {
        fields: { routingKey: 'user.delete' }
      }
    );
    expect(user.ban).toBe(true);
    expect(availability.saveUserAvailability).toHaveBeenCalledWith(
      user,
      transaction
    );
  });
});
