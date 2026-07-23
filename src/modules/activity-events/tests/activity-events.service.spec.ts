import { Op } from 'sequelize';
import {
  ActivityActionType,
  ActivityEntityType
} from '../activity-events.constants';
import { ActivityEventsService } from '../activity-events.service';

describe('ActivityEventsService', () => {
  const repository = {
    create: jest.fn(),
    findAll: jest.fn()
  };
  const service = new ActivityEventsService(repository as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('создаёт событие в переданной транзакции', async () => {
    const transaction = {} as any;
    const event = {
      projectId: 1,
      entityType: ActivityEntityType.Task,
      entityId: '42',
      actionType: ActivityActionType.Updated,
      actorUserId: 7
    };
    repository.create.mockResolvedValue({ id: 10, ...event });

    await service.create(event, { transaction });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ...event,
        changes: [],
        metadata: {}
      }),
      { transaction }
    );
  });

  it('оставляет только реально изменённые поля', () => {
    expect(
      service.buildChanges({
        title: { before: 'Задача', after: 'Задача' },
        assigneeIds: { before: [1, 2], after: [1, 2] },
        priority: { before: 'low', after: 'high' }
      })
    ).toEqual([{ field: 'priority', before: 'low', after: 'high' }]);
  });

  it('возвращает cursor-страницу истории в обратном порядке', async () => {
    repository.findAll.mockResolvedValue([{ id: 9 }, { id: 8 }, { id: 7 }]);

    const result = await service.findByEntity({
      projectId: 1,
      entityType: ActivityEntityType.Task,
      entityId: '42',
      limit: 2,
      beforeId: 10
    });

    const options = repository.findAll.mock.calls[0][0];
    expect(options.where).toEqual(
      expect.objectContaining({
        projectId: 1,
        entityType: ActivityEntityType.Task,
        entityId: '42'
      })
    );
    expect(options.where.id[Op.lt]).toBe(10);
    expect(options.order).toEqual([['id', 'DESC']]);
    expect(options.limit).toBe(3);
    expect(result).toEqual({
      items: [{ id: 9 }, { id: 8 }],
      nextCursor: 8
    });
  });
});
