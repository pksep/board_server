import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Test } from '@nestjs/testing';
import { TasksService } from '../tasks/tasks.service';
import { TaskCommentCountersService } from './task-comment-counters.service';

describe('task comment counter gateway', () => {
  let service: TaskCommentCountersService;
  const tasks = {
    getPersonalTaskIds: jest.fn(),
    assertCanReadTaskComments: jest.fn()
  };
  const session = {
    cookies: { access_token: 'isolated-session' },
    headers: { origin: 'http://isolated.invalid' }
  };
  const post = jest.spyOn(axios, 'post');
  const originalKey = process.env.COMMENTS_COUNTERS_KEY;

  beforeEach(async (): Promise<void> => {
    process.env.COMMENTS_COUNTERS_KEY =
      'test-only-counter-gateway-key-not-production';
    jest.clearAllMocks();
    tasks.assertCanReadTaskComments.mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      providers: [
        TaskCommentCountersService,
        { provide: TasksService, useValue: tasks },
        {
          provide: ConfigService,
          useValue: { get: (): string => 'http://isolated-erp.invalid' }
        }
      ]
    }).compile();
    service = module.get(TaskCommentCountersService);
  });

  afterAll((): void => {
    post.mockRestore();
    if (originalKey === undefined) delete process.env.COMMENTS_COUNTERS_KEY;
    else process.env.COMMENTS_COUNTERS_KEY = originalKey;
  });

  it('counts the whole server-selected scope in bounded batches, without sending an actor ID', async (): Promise<void> => {
    const ids = Array.from({ length: 1001 }, (_, index) => index + 1);
    tasks.getPersonalTaskIds.mockResolvedValue(ids);
    post.mockImplementation(
      async (
        _url,
        body
      ): Promise<{
        data: { entityId: number; total: number; unread: number }[];
      }> => {
        const input = body as {
          entityIds: number[];
          markRead: boolean;
          userId?: number;
        };
        expect(input.markRead).toBe(false);
        expect(input.userId).toBeUndefined();
        expect(input.entityIds.length).toBeLessThanOrEqual(500);

        return {
          data: input.entityIds.map(entityId => ({
            entityId,
            total: 2,
            unread: 1
          }))
        };
      }
    );
    const result = await service.personal(7, { scope: 'assigned' }, session);
    expect(tasks.getPersonalTaskIds).toHaveBeenCalledWith(7, {
      scope: 'assigned'
    });
    expect(post).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ total: 2002, unread: 1001, taskIds: ids });
    expect(result.tasks).toHaveLength(1001);
    expect(post.mock.calls[0][2]).toMatchObject({
      headers: {
        Cookie: 'access_token=isolated-session',
        Origin: 'http://isolated.invalid',
        compress: 'no-compress'
      }
    });
  });

  it('marks exactly one available task and preserves comments arriving during marking', async (): Promise<void> => {
    post.mockResolvedValue({ data: [{ entityId: 151, total: 5, unread: 1 }] });
    expect(await service.markTaskRead(151, 7, session)).toMatchObject({
      total: 5,
      unread: 1,
      tasks: [{ taskId: 151, total: 5, unread: 1 }]
    });
    expect(tasks.assertCanReadTaskComments).toHaveBeenCalledWith(151, 7);
    expect(post.mock.calls[0][1]).toEqual({
      entityType: 'tasks',
      entityIds: [151],
      markRead: true
    });
  });

  it('embeds totals into every authorized task snapshot and nested child with one batch', async (): Promise<void> => {
    const child = { id: 64, setDataValue: jest.fn() };
    const parent = {
      id: 151,
      subtasks: [child],
      setDataValue: jest.fn()
    };
    const flatChild = { id: 64, setDataValue: jest.fn() };
    post.mockResolvedValue({
      data: [
        { entityId: 151, total: 5, unread: 0 },
        { entityId: 64, total: 0, unread: 0 }
      ]
    });

    await service.attachToTasks([parent, flatChild], session);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1]).toEqual({
      entityType: 'tasks',
      entityIds: [151, 64],
      markRead: false,
      totalsOnly: true
    });
    expect(parent.setDataValue).toHaveBeenCalledWith('commentsCount', 5);
    expect(child.setDataValue).toHaveBeenCalledWith('commentsCount', 0);
    expect(flatChild.setDataValue).toHaveBeenCalledWith('commentsCount', 0);
    // Канонический список уже проверил доступ; повторного чтения каждой задачи нет.
    expect(tasks.assertCanReadTaskComments).not.toHaveBeenCalled();
  });

  it('does not query counters for an empty task page', async (): Promise<void> => {
    await service.attachToTasks([], session);
    expect(post).not.toHaveBeenCalled();
  });

  it('does not fill task snapshots with zero when the count service fails', async (): Promise<void> => {
    const task = { id: 151, setDataValue: jest.fn() };
    post.mockRejectedValue(new Error('Unavailable'));

    await expect(service.attachToTasks([task], session)).rejects.toMatchObject({
      status: 503
    });
    expect(task.setDataValue).not.toHaveBeenCalled();
  });

  it('checks access before marking, so a forged task ID cannot clear any state', async (): Promise<void> => {
    tasks.assertCanReadTaskComments.mockRejectedValue(
      new Error('Access denied')
    );
    await expect(service.markTaskRead(151, 7, session)).rejects.toThrow(
      'Access denied'
    );
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    { data: [] },
    { data: [{ entityId: 999, total: 1, unread: 1 }] },
    { data: [{ entityId: 151, total: 1, unread: 2 }] },
    { data: [{ entityId: 151, total: -1, unread: 0 }] },
    {
      data: [
        { entityId: 151, total: 1, unread: 0 },
        { entityId: 151, total: 1, unread: 0 }
      ]
    }
  ])(
    'does not treat an incomplete or invalid upstream response as zero: %p',
    async ({ data }): Promise<void> => {
      post.mockResolvedValue({ data });
      await expect(service.markTaskRead(151, 7, session)).rejects.toMatchObject(
        { status: 503 }
      );
    }
  );

  it('does not terminate a user session on a gateway configuration failure', async (): Promise<void> => {
    post.mockRejectedValue({ isAxiosError: true, response: { status: 401 } });
    await expect(service.markTaskRead(151, 7, session)).rejects.toMatchObject({
      status: 503
    });
    await expect(
      service.markTaskRead(151, 7, { headers: {} })
    ).rejects.toMatchObject({ status: 401 });
  });
});
