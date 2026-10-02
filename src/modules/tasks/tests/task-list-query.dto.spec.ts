import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TaskListQueryDto } from '../dto/task-list-query.dto';

describe('TaskListQueryDto', () => {
  it('принимает независимые ISO-границы обоих периодов', async (): Promise<void> => {
    const dates = {
      startDateFrom: '2026-09-30T21:00:00.000Z',
      startDateTo: '2026-10-01T20:59:59.999Z',
      dueDateFrom: '2026-10-02T21:00:00.000Z',
      dueDateTo: '2026-10-03T20:59:59.999Z'
    };
    const query = plainToInstance(TaskListQueryDto, dates);

    await expect(validate(query)).resolves.toEqual([]);
    expect(query).toEqual(expect.objectContaining(dates));
    await expect(
      validate(
        plainToInstance(TaskListQueryDto, {
          startDateFrom: dates.startDateFrom
        })
      )
    ).resolves.toEqual([]);
  });

  it.each(['startDateFrom', 'startDateTo', 'dueDateFrom', 'dueDateTo'])(
    'отклоняет некорректную или несуществующую дату в %s',
    async (field: string): Promise<void> => {
      for (const value of [
        'invalid',
        '2026-02-30T00:00:00Z',
        '2026-13-01T00:00:00Z',
        ['2026-10-01', '2026-10-02']
      ]) {
        const query = plainToInstance(TaskListQueryDto, { [field]: value });
        const errors = await validate(query);

        expect(errors.map(error => error.property)).toContain(field);
      }
    }
  );

  it('преобразует списки фильтров из query-строки', async () => {
    const query = plainToInstance(TaskListQueryDto, {
      limit: '5',
      offset: '0',
      assigneeIds: '7,15',
      creatorIds: ['7', '15,22'],
      priorities: 'high,urgent',
      tagIds: ['3', '9'],
      includeSubtasks: 'true'
    });

    await expect(validate(query)).resolves.toEqual([]);
    expect(query).toEqual(
      expect.objectContaining({
        limit: 5,
        offset: 0,
        assigneeIds: [7, 15],
        creatorIds: [7, 15, 22],
        priorities: ['high', 'urgent'],
        tagIds: [3, 9],
        includeSubtasks: true
      })
    );
  });

  it('отклоняет неизвестный приоритет и некорректный boolean', async () => {
    const query = plainToInstance(TaskListQueryDto, {
      priorities: 'critical',
      includeSubtasks: 'yes'
    });

    const errors = await validate(query);
    expect(errors.map(error => error.property)).toEqual(
      expect.arrayContaining(['priorities', 'includeSubtasks'])
    );
  });

  it.each(['0', '-1', '1.5', 'пользователь', Array(101).fill('7')])(
    'отклоняет некорректные идентификаторы или превышение лимита создателей: %p',
    async creatorIds => {
      const query = plainToInstance(TaskListQueryDto, { creatorIds });

      const errors = await validate(query);

      expect(errors.map(error => error.property)).toContain('creatorIds');
    }
  );

  it.each([undefined, []])(
    'сохраняет запрос без выбранных создателей: %p',
    async creatorIds => {
      const query = plainToInstance(TaskListQueryDto, { creatorIds });

      await expect(validate(query)).resolves.toEqual([]);
    }
  );
});
