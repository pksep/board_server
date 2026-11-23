import { TasksService } from '../tasks.service';
import type { TaskFilterCandidate } from '../interfaces/task-filter-candidate.interface';
import type { TaskListQueryDto } from '../dto/task-list-query.dto';

describe('Column task date bound preparation', () => {
  const epoch = '1970-01-01T00:00:00.000Z';
  const rows: TaskFilterCandidate[] = [
    {
      id: 1,
      parentTaskId: null,
      startDate: new Date(-1),
      dueDate: new Date(0)
    },
    { id: 2, parentTaskId: null, startDate: new Date(0), dueDate: new Date(0) },
    { id: 3, parentTaskId: 2, startDate: new Date(1), dueDate: new Date(1) },
    { id: 4, parentTaskId: null },
    {
      id: 5,
      parentTaskId: null,
      startDate: new Date(NaN),
      dueDate: new Date(NaN)
    }
  ];
  const service: TasksService = Object.assign(
    Object.create(TasksService.prototype),
    { findFilterCandidates: jest.fn().mockResolvedValue(rows) }
  );

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  it.each<{ query: TaskListQueryDto; ids: number[] }>([
    { query: { startDateFrom: epoch }, ids: [2, 3] },
    { query: { startDateTo: epoch }, ids: [1, 2] },
    { query: { startDateFrom: epoch, startDateTo: epoch }, ids: [2] },
    { query: { dueDateFrom: epoch, dueDateTo: epoch }, ids: [1, 2] },
    { query: { startDateFrom: epoch, dueDateTo: epoch }, ids: [2] },
    { query: { startDateTo: '1969-12-31T23:59:59.999Z' }, ids: [1] },
    { query: {}, ids: [1, 2, 3, 4, 5] },
    { query: { startDateFrom: '', dueDateTo: '' }, ids: [1, 2, 3, 4, 5] },
    { query: { startDateFrom: 'invalid' }, ids: [] },
    { query: { dueDateTo: 'invalid' }, ids: [] }
  ])(
    'keeps inclusive/empty/invalid date behavior for $query',
    async ({ query, ids }): Promise<void> => {
      expect(
        await service['findFilteredRootTaskIds'](1, {
          ...query,
          flatSubtasks: true
        })
      ).toEqual(ids);
    }
  );

  it('maps date-matching descendants to the same roots', async (): Promise<void> => {
    expect(
      await service['findFilteredRootTaskIds'](1, {
        startDateFrom: epoch,
        includeSubtasks: true
      })
    ).toEqual([2]);
  });

  it('parses four fixed bounds only once per filter call', async (): Promise<void> => {
    const parse = jest.spyOn(Date, 'parse');
    await service['findFilteredRootTaskIds'](1, {
      startDateFrom: '1969-01-01',
      startDateTo: '1971-01-01',
      dueDateFrom: '1969-01-01',
      dueDateTo: '1971-01-01',
      flatSubtasks: true
    });

    expect(parse).toHaveBeenCalledTimes(4);
  });
});
