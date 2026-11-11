import { Test } from '@nestjs/testing';
import { TasksController } from '../tasks.controller';
import { TasksService } from '../tasks.service';
import { TaskCommentCountersService } from '../../task-comment-counters/task-comment-counters.service';
import type { Task } from '../model/task.model';
import type { IUserDataToken } from '../../auth/interfaces/interface';
import { TimeReportPermissionGuard } from '../time-report-permission.guard';

describe('commentsCount in task responses', () => {
  const task = { id: 7 } as Task;
  const tasks = {
    getByBoard: jest.fn(),
    getByColumn: jest.fn(),
    getById: jest.fn(),
    getSubtasks: jest.fn(),
    getPersonalTasks: jest.fn()
  };
  const counters = { attachToTasks: jest.fn() };
  const user = { id: 17 } as IUserDataToken;
  const request = {
    cookies: { access_token: 'test-session' },
    headers: {}
  };
  let controller: TasksController;

  beforeEach(async (): Promise<void> => {
    jest.resetAllMocks();
    delete task.commentsCount;
    counters.attachToTasks.mockImplementation(
      async (records: Task[]): Promise<void> => {
        for (const record of records) record.commentsCount = 4;
      }
    );
    tasks.getByBoard.mockResolvedValue([task]);
    tasks.getByColumn.mockResolvedValue({
      items: [task],
      total: 10,
      limit: 1,
      offset: 2,
      hasMore: true
    });
    tasks.getById.mockResolvedValue(task);
    tasks.getSubtasks.mockResolvedValue([task]);
    tasks.getPersonalTasks.mockResolvedValue({
      items: [{ task, projectId: 3, projectPrefix: 'P' }],
      offset: 1,
      hasMore: true
    });
    const module = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        { provide: TasksService, useValue: tasks },
        { provide: TaskCommentCountersService, useValue: counters }
      ]
    })
      .overrideGuard(TimeReportPermissionGuard)
      .useValue({ canActivate: (): boolean => true })
      .compile();
    controller = module.get(TasksController);
  });

  it.each([
    'board',
    'column',
    'detail',
    'subtasks',
    'personal',
    'executor'
  ] as const)(
    'returns counts inside the %s task response',
    async (route): Promise<void> => {
      let response: unknown;
      if (route === 'board')
        response = await controller.getByBoard(3, user, request);
      if (route === 'column')
        response = await controller.getByColumn(
          42,
          { limit: 1, offset: 2 },
          user,
          request
        );
      if (route === 'detail')
        response = await controller.getById(7, user, request);
      if (route === 'subtasks')
        response = await controller.getSubtasks(7, user, request);
      if (route === 'personal')
        response = await controller.getPersonalTasks(
          { scope: 'assigned' },
          user,
          request
        );
      if (route === 'executor')
        response = await controller.getExecutorTasks(
          { erpUserId: 12 },
          user,
          request
        );

      expect(counters.attachToTasks).toHaveBeenCalledTimes(1);
      expect(counters.attachToTasks).toHaveBeenCalledWith([task], request);
      expect(task.commentsCount).toBe(4);
      expect(JSON.stringify(response)).toContain('"commentsCount":4');
      if (route === 'column')
        expect(response).toMatchObject({
          total: 10,
          limit: 1,
          offset: 2,
          hasMore: true
        });
      if (route === 'personal')
        expect(response).toMatchObject({ offset: 1, hasMore: true });
    }
  );

  it('checks task access before obtaining comments metadata', async (): Promise<void> => {
    tasks.getById.mockRejectedValue(new Error('Access denied'));
    await expect(controller.getById(7, user, request)).rejects.toThrow(
      'Access denied'
    );
    expect(counters.attachToTasks).not.toHaveBeenCalled();
  });

  it('preserves legacy unpaginated column responses', async (): Promise<void> => {
    tasks.getByColumn.mockResolvedValue([task]);
    expect(await controller.getByColumn(42, {}, user, request)).toEqual([
      { id: 7, commentsCount: 4 }
    ]);
  });
});
