import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TaskListQueryDto } from '../dto/task-list-query.dto';

describe('TaskListQueryDto', () => {
  it('преобразует списки фильтров из query-строки', async () => {
    const query = plainToInstance(TaskListQueryDto, {
      limit: '5',
      offset: '0',
      assigneeIds: '7,15',
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
});
