import axios from 'axios';
import { ProjectsMcpTaskCommentsService } from '../projects-mcp-task-comments.service';
import { ProjectsMcpAuthContext } from '../interfaces/projects-mcp.interface';

describe('ProjectsMcpTaskCommentsService', () => {
  const configService = {
    get: jest.fn().mockReturnValue('https://erp.example')
  };
  const tasksService = {
    getById: jest.fn().mockResolvedValue({ id: 42, columnId: 3 })
  };
  const service = new ProjectsMcpTaskCommentsService(
    configService as any,
    tasksService as any
  );
  const auth: ProjectsMcpAuthContext = {
    user: { id: 7, login: 'DA', serviceNumber: '007' },
    clientId: 'codex',
    audience: 'board-projects-mcp',
    scopes: new Set(['projects:read', 'projects:update']),
    accessToken: 'short-lived-mcp-token'
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('проверяет доступ к задаче и читает комментарии с MCP bearer token', async () => {
    jest.spyOn(axios, 'request').mockResolvedValue({
      data: { rows: [], count: 0 }
    });

    await expect(service.list(42, 0, 20, auth)).resolves.toEqual({
      rows: [],
      count: 0
    });

    expect(tasksService.getById).toHaveBeenCalledWith(42, 7);
    expect(axios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'get',
        url: 'https://erp.example/api/comments/by-entity/tasks/42',
        params: { page: 0, limit: 20 },
        headers: expect.objectContaining({
          Authorization: 'Bearer short-lived-mcp-token'
        })
      })
    );
  });

  it('создаёт комментарий или reply без помещения token в body', async () => {
    jest.spyOn(axios, 'request').mockResolvedValue({
      data: { id: 'comment-1', thread_id: 'thread-1' }
    });

    await service.create(
      42,
      {
        content: '<p>Готово</p>',
        threadId: 'thread-1',
        answerCommentId: 'comment-0'
      },
      auth
    );

    expect(axios.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'post',
        url: 'https://erp.example/api/comments/create',
        data: {
          content: '<p>Готово</p>',
          entityId: 42,
          entityType: 'tasks',
          threadId: 'thread-1',
          answerCommentId: 'comment-0'
        }
      })
    );
    expect(
      JSON.stringify((axios.request as jest.Mock).mock.calls[0][0].data)
    ).not.toContain('short-lived-mcp-token');
  });
});
