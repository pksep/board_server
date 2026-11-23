import { Op } from 'sequelize';
import { TasksService } from '../tasks.service';
import { User } from '../../users/model/users.model';

describe('Executor task display context', () => {
  afterEach((): void => {
    jest.restoreAllMocks();
  });

  /** Подменяет только чтение уже выбранной страницы, без правок канонического SQL. */
  function fixture() {
    const tasks = [
      {
        id: 10,
        createdById: 1,
        controllerIds: [2, 3],
        responsibleIds: [3, 4],
        assignees: [{ userId: 4 }, { userId: 5 }],
        customAttributeValues: { reviewers: ['6', 2, 6, 'invalid'], text: '7' },
        parentTaskId: 100
      },
      {
        id: 20,
        createdById: 1,
        controllerIds: null,
        responsibleIds: [],
        assignees: [],
        customAttributeValues: { reviewers: [7] },
        parentTaskId: 100
      },
      {
        id: 30,
        createdById: 1,
        controllerIds: [],
        responsibleIds: [],
        assignees: [],
        customAttributeValues: {},
        parentTaskId: 999
      }
    ];
    const locations = tasks.map(task => ({
      id: task.id,
      total: tasks.length,
      projectId: task.id,
      displayContext: { projectTitle: `Project ${task.id}` }
    }));
    const parent = { id: 100, title: 'Parent' };
    const repository = {
      findAll: jest
        .fn()
        .mockResolvedValueOnce(tasks)
        .mockResolvedValue([parent])
    };
    const sequelize = { query: jest.fn().mockResolvedValue(locations) };
    const service = new TasksService(
      repository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      sequelize as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    return { service, repository, parent, tasks };
  }

  it('keeps each task user scope, query ordering and shared/missing parents', async (): Promise<void> => {
    const { service, repository, parent } = fixture();
    const users = [6, 5, 7, 4, 3, 2, 1].map(id => ({
      id,
      login: `User ${id}`
    }));
    const findUsers = jest
      .spyOn(User, 'findAll')
      .mockResolvedValue(users as User[]);

    const result = await service.getPersonalTasks(1, { limit: 20 }, 'erp-1');

    expect(
      result.items.map(item => item.displayContext.users.map(user => user.id))
    ).toEqual([[6, 5, 4, 3, 2], [7, 1], []]);
    expect(result.items[0].displayContext.parentTask).toBe(parent);
    expect(result.items[1].displayContext.parentTask).toBe(parent);
    expect(result.items[2].displayContext.parentTask).toBeUndefined();
    expect(findUsers.mock.calls[0][0].where).toEqual({
      id: { [Op.in]: [2, 3, 4, 5, 6, 1, 7] }
    });
    expect(repository.findAll.mock.calls[1][0].where).toEqual({
      id: { [Op.in]: [100, 999] }
    });
  });

  it('keeps unresolved user references out of the display payload', async (): Promise<void> => {
    const { service } = fixture();
    jest.spyOn(User, 'findAll').mockResolvedValue([]);

    const result = await service.getPersonalTasks(1, { limit: 20 }, 'erp-1');

    expect(
      result.items.every(item => item.displayContext.users.length === 0)
    ).toBe(true);
  });
});
