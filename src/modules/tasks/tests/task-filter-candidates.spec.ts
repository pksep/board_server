import { Op } from 'sequelize';
import { TasksService } from '../tasks.service';
import type { TaskFilterCandidate } from '../interfaces/task-filter-candidate.interface';

describe('Column task creator filtering', () => {
  const rows: TaskFilterCandidate[] = [
    { id: 1, parentTaskId: null, createdById: 5, priority: 'low' },
    { id: 2, parentTaskId: 1, createdById: 7, priority: 'urgent' },
    { id: 3, parentTaskId: null, createdById: 7, priority: 'low' },
    { id: 4, parentTaskId: null, createdById: 99, priority: 'urgent' }
  ];
  const findAll = jest.fn();
  const service: TasksService = Object.assign(
    Object.create(TasksService.prototype),
    {
      findFilterCandidates: jest.fn().mockResolvedValue(rows),
      assigneeRepository: { findAll },
      taskTagRepository: { findAll }
    }
  );

  beforeEach((): void => {
    findAll.mockReset();
  });

  it('combines creator and priority matches before mapping matching children to roots', async (): Promise<void> => {
    const result = await service['findFilteredRootTaskIds'](1, {
      creatorIds: [7, 7],
      priorities: ['urgent'],
      includeSubtasks: true
    });

    expect(result).toEqual([1]);
  });

  it('preserves flat ordering, empty filters and priority behavior without includeSubtasks', async (): Promise<void> => {
    expect(
      await service['findFilteredRootTaskIds'](1, {
        creatorIds: [],
        flatSubtasks: true
      })
    ).toEqual([1, 2, 3, 4]);
    expect(
      await service['findFilteredRootTaskIds'](1, {
        creatorIds: [7],
        priorities: ['urgent'],
        flatSubtasks: true,
        includeSubtasks: false
      })
    ).toEqual([2, 3]);
  });

  it('keeps association queries scoped to the same matched candidates', async (): Promise<void> => {
    findAll
      .mockResolvedValueOnce([{ taskId: 2 }])
      .mockResolvedValueOnce([{ taskId: 2 }]);

    expect(
      await service['findFilteredRootTaskIds'](1, {
        creatorIds: [7],
        assigneeIds: [10, 10],
        tagIds: [11],
        flatSubtasks: true
      })
    ).toEqual([2]);
    expect(findAll).toHaveBeenNthCalledWith(1, {
      where: {
        taskId: { [Op.in]: [2, 3] },
        userId: { [Op.in]: [10, 10] }
      },
      attributes: ['taskId'],
      raw: true
    });
    expect(findAll).toHaveBeenNthCalledWith(2, {
      where: {
        taskId: { [Op.in]: [2] },
        projectTagId: { [Op.in]: [11] }
      },
      attributes: ['taskId'],
      raw: true
    });
  });

  it('does not scan the creator filter again for each candidate', async (): Promise<void> => {
    const creatorIds = Array.from({ length: 100 }, (_, index) => index + 1);
    const includes = jest.spyOn(creatorIds, 'includes');

    expect(
      await service['findFilteredRootTaskIds'](1, {
        creatorIds,
        flatSubtasks: true
      })
    ).toEqual([1, 2, 3, 4]);
    expect(includes).not.toHaveBeenCalled();
  });
});
