import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ExecutorWorkloadQueryDto } from '../dto/executor-workload-query.dto';

describe('ExecutorWorkloadQueryDto', () => {
  it.each([
    ['true', true],
    ['false', false]
  ])(
    'преобразует onlyProductionProjects=%s в %s',
    async (value, expected): Promise<void> => {
      const query = plainToInstance(ExecutorWorkloadQueryDto, {
        start: '2026-11-01T00:00:00Z',
        end: '2026-11-15T00:00:00Z',
        onlyProductionProjects: value
      });

      await expect(validate(query)).resolves.toEqual([]);
      expect(query.onlyProductionProjects).toBe(expected);
    }
  );

  it('отклоняет неявное boolean-значение фильтра проектов', async (): Promise<void> => {
    const query = plainToInstance(ExecutorWorkloadQueryDto, {
      start: '2026-11-01T00:00:00Z',
      end: '2026-11-15T00:00:00Z',
      onlyProductionProjects: 'yes'
    });
    const errors = await validate(query);

    expect(errors.map(error => error.property)).toContain(
      'onlyProductionProjects'
    );
  });
});
