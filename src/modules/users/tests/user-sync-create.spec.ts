import { Op, UniqueConstraintError } from 'sequelize';
import { UserSyncConsumer } from '../user-sync.consumer';

describe('UserSyncConsumer user.create', () => {
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  const repository = {
    findAll: jest.fn(),
    create: jest.fn()
  };
  const sequelize = {
    transaction: jest.fn(async callback => callback(transaction))
  };
  const usersService = { saveUserAvailability: jest.fn() };
  const consumer = new UserSyncConsumer(
    repository as never,
    sequelize as never,
    usersService as never
  );
  const event = {
    entity: { id: 42, tabel: '0042', login: 'ivanov', initial: 'Иванов' }
  };
  const message = { fields: { routingKey: 'user.create' } };

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findAll.mockResolvedValue([]);
    repository.create.mockResolvedValue({ id: 7 });
  });

  it('создаёт пользователя, если оба идентификатора свободны', async () => {
    await consumer.handleUserEvent(event, message);

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        erpId: '42',
        serviceNumber: '0042',
        login: 'ivanov'
      }),
      { transaction }
    );
  });

  it('обновляет erpId существующей записи по serviceNumber и сохраняет Board ID', async () => {
    const user = {
      id: 7,
      erpId: 'old-erp-id',
      serviceNumber: '0042',
      initial: 'Иванов',
      login: 'ivanov',
      ban: false,
      save: jest.fn()
    };
    repository.findAll.mockResolvedValue([user]);

    await consumer.handleUserEvent(event, message);

    expect(repository.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          [Op.or]: [{ erpId: '42' }, { serviceNumber: '0042' }]
        },
        limit: 2,
        transaction
      })
    );
    expect(user.id).toBe(7);
    expect(user.erpId).toBe('42');
    expect(user.save).toHaveBeenCalledWith({ transaction });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('повторное событие не выполняет лишнюю запись', async () => {
    const user = {
      id: 7,
      erpId: '42',
      serviceNumber: '0042',
      initial: 'Иванов',
      login: 'ivanov',
      ban: false,
      save: jest.fn()
    };
    repository.findAll.mockResolvedValue([user]);

    await consumer.handleUserEvent(event, message);
    await consumer.handleUserEvent(event, message);

    expect(user.save).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('после гонки INSERT перечитывает созданную запись один раз', async () => {
    const user = {
      id: 7,
      erpId: 'old-erp-id',
      serviceNumber: '0042',
      ban: false,
      save: jest.fn()
    };
    repository.findAll.mockResolvedValueOnce([]).mockResolvedValueOnce([user]);
    repository.create.mockRejectedValueOnce(
      new UniqueConstraintError({ message: 'duplicate service_number' })
    );

    await consumer.handleUserEvent(event, message);

    expect(sequelize.transaction).toHaveBeenCalledTimes(2);
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(user.erpId).toBe('42');
    expect(user.save).toHaveBeenCalledTimes(1);
  });

  it('не объединяет две разные записи при конфликте erpId и serviceNumber', async () => {
    repository.findAll.mockResolvedValue([
      { id: 7, erpId: '42', serviceNumber: 'old-number' },
      { id: 8, erpId: 'other', serviceNumber: '0042' }
    ]);

    await expect(consumer.handleUserEvent(event, message)).rejects.toThrow(
      'Conflicting Board users'
    );
    expect(repository.create).not.toHaveBeenCalled();
    expect(usersService.saveUserAvailability).not.toHaveBeenCalled();
  });

  it('отклоняет событие без ERP ID', async () => {
    await expect(
      consumer.handleUserEvent({ entity: { tabel: '0042' } }, message)
    ).rejects.toThrow('ERP user id');
    expect(repository.findAll).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });
});
