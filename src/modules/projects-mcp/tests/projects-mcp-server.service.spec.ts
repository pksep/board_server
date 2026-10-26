import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ProjectsMcpServerService } from '../projects-mcp-server.service';
import {
  PROJECTS_MCP_SCOPES,
  PROJECTS_MCP_AUDIENCE,
  PROJECTS_MCP_TOOL_SCOPES
} from '../projects-mcp.constants';

describe('ProjectsMcpServerService', () => {
  const projectsService = {
    getAll: jest
      .fn()
      .mockResolvedValue([
        { id: 1, title: 'Board', prefix: 'BRD', description: '' }
      ]),
    getById: jest.fn().mockResolvedValue({ id: 1, title: 'Board' }),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
  };
  const projectAccess = {
    assertCanRead: jest.fn(),
    assertCanManage: jest.fn()
  };
  const boardsService = {
    getByProject: jest.fn().mockResolvedValue([]),
    getById: jest.fn().mockResolvedValue({ id: 2, projectId: 1, columns: [] }),
    create: jest.fn(),
    update: jest.fn(),
    reorder: jest.fn(),
    delete: jest.fn()
  };
  const columnsService = {
    getByBoard: jest.fn().mockResolvedValue([]),
    getById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    reorder: jest.fn(),
    delete: jest.fn()
  };
  const tasksService = {
    getByBoard: jest.fn().mockResolvedValue([]),
    getByColumn: jest.fn().mockResolvedValue([]),
    getById: jest.fn(),
    getSubtasks: jest.fn().mockResolvedValue([]),
    getHistory: jest.fn().mockResolvedValue({ rows: [], count: 0 }),
    getPersonalTasks: jest
      .fn()
      .mockResolvedValue({ items: [], offset: 0, hasMore: false }),
    getTimeEntries: jest
      .fn()
      .mockResolvedValue({ items: [], nextCursor: null }),
    createTimeEntry: jest.fn(),
    create: jest.fn(),
    createSubtask: jest.fn(),
    update: jest.fn(),
    move: jest.fn(),
    delete: jest.fn()
  };
  const tagsService = {
    getByProject: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
  };
  const usersService = {
    getUsersList: jest.fn().mockResolvedValue([])
  };
  const operations = {
    run: jest.fn()
  };
  const taskComments = {
    list: jest.fn().mockResolvedValue({ rows: [], count: 0 }),
    create: jest.fn()
  };
  const service = new ProjectsMcpServerService(
    projectsService as any,
    projectAccess as any,
    boardsService as any,
    columnsService as any,
    tasksService as any,
    tagsService as any,
    usersService as any,
    operations as any,
    taskComments as any
  );

  beforeEach(() => {
    jest.clearAllMocks();
    operations.run.mockImplementation(
      async (...args: any[]) => (await args[4]()).value
    );
  });

  it('публикует полный набор типизированных tools стандартному MCP-клиенту', async () => {
    const server = service.createServer({
      user: { id: 7, login: 'DA', serviceNumber: '007' },
      clientId: 'jest',
      audience: PROJECTS_MCP_AUDIENCE,
      scopes: new Set(PROJECTS_MCP_SCOPES),
      accessToken: 'mcp-token'
    });
    const client = new Client({ name: 'jest-client', version: '1.0.0' });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.listTools();
    expect(result.tools.map(tool => tool.name).sort()).toEqual(
      [
        'board_columns_list',
        'board_tasks_list',
        'boards_create',
        'boards_delete',
        'boards_get',
        'boards_reorder',
        'boards_update',
        'column_tasks_list',
        'columns_create',
        'columns_delete',
        'columns_get',
        'columns_reorder',
        'columns_update',
        'project_boards_list',
        'project_members_list',
        'project_members_update',
        'project_tags_list',
        'project_tags_create',
        'project_tags_delete',
        'project_tags_update',
        'projects_create',
        'projects_delete',
        'projects_favorite_set',
        'projects_get',
        'projects_list',
        'projects_reorder',
        'projects_update',
        'subtasks_create',
        'task_comments_create',
        'task_comments_list',
        'task_history_list',
        'tasks_personal_list',
        'task_attributes_get',
        'task_attributes_update',
        'task_time_entries_list',
        'task_time_entries_create',
        'task_subtasks_list',
        'tasks_create',
        'tasks_delete',
        'tasks_get',
        'tasks_move',
        'tasks_update',
        'users_list'
      ].sort()
    );
    result.tools.forEach(tool => {
      expect(PROJECTS_MCP_TOOL_SCOPES[tool.name]).toBeDefined();
    });

    const list = await client.callTool({
      name: 'projects_list',
      arguments: {}
    });
    expect(list.structuredContent).toEqual({
      data: [{ id: 1, title: 'Board', prefix: 'BRD', description: '' }]
    });

    await client.callTool({
      name: 'project_boards_list',
      arguments: { projectId: 1 }
    });
    expect(boardsService.getByProject).toHaveBeenCalledWith(1, 7);

    await client.callTool({
      name: 'boards_get',
      arguments: { boardId: 2 }
    });
    expect(boardsService.getById).toHaveBeenCalledWith(2, 7);

    await client.callTool({
      name: 'task_comments_list',
      arguments: { taskId: 3 }
    });
    expect(taskComments.list).toHaveBeenCalledWith(3, 0, 20, {
      user: { id: 7, login: 'DA', serviceNumber: '007' },
      clientId: 'jest',
      audience: PROJECTS_MCP_AUDIENCE,
      scopes: new Set(PROJECTS_MCP_SCOPES),
      accessToken: 'mcp-token'
    });

    await client.close();
    await server.close();
  });

  it('читает атрибуты, записывает отдельные изменения и время только текущего пользователя', async (): Promise<void> => {
    const auth = {
      user: { id: 7, login: 'DA', serviceNumber: '007' },
      clientId: 'jest',
      audience: PROJECTS_MCP_AUDIENCE,
      scopes: new Set(PROJECTS_MCP_SCOPES),
      accessToken: 'mcp-token'
    };
    projectsService.getById.mockResolvedValueOnce({
      id: 1,
      title: 'Board',
      taskAttributeDefinitions: [
        { id: 'flag', name: 'Проверено', type: 'boolean' },
        { id: 'count', name: 'Количество', type: 'number' },
        { id: 'text', name: 'Описание', type: 'text' }
      ]
    });
    tasksService.getById.mockResolvedValue({
      id: 3,
      title: 'Проверить',
      columnId: 4,
      customAttributeValues: { flag: false, count: 0 }
    });
    columnsService.getById.mockResolvedValue({ id: 4, boardId: 2 });
    const server = service.createServer(auth);
    const client = new Client({ name: 'jest-task-details', version: '1' });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.callTool({
        name: 'task_attributes_get',
        arguments: { taskId: 3 }
      });
      expect(result.structuredContent).toMatchObject({
        data: {
          attributes: [
            { id: 'flag', value: false, hasValue: true },
            { id: 'count', value: 0, hasValue: true },
            { id: 'text', value: null, hasValue: false }
          ]
        }
      });
      projectsService.getById.mockResolvedValueOnce({
        id: 1,
        title: 'Board',
        taskAttributeDefinitions: [
          { id: 'flag', name: 'Проверено', type: 'boolean' }
        ]
      });
      tasksService.update.mockResolvedValue({ id: 3 });
      const update = await client.callTool({
        name: 'task_attributes_update',
        arguments: {
          taskId: 3,
          taskTitle: 'Проверить',
          attributes: [
            { id: 'flag', name: 'Проверено', type: 'boolean', value: false }
          ],
          idempotencyKey: 'task-attrs-1'
        }
      });
      expect(update.isError).not.toBe(true);
      expect(tasksService.update).toHaveBeenCalledWith(
        3,
        { customAttributeChanges: { flag: false } },
        7
      );

      const absent = await client.callTool({
        name: 'task_attributes_update',
        arguments: {
          taskId: 3,
          taskTitle: 'Проверить',
          attributes: [
            { id: 'missing', name: 'Нет поля', type: 'text', value: 'test' }
          ],
          idempotencyKey: 'task-attrs-2'
        }
      });
      expect(absent.isError).toBe(true);
      expect(tasksService.update).toHaveBeenCalledTimes(1);

      tasksService.createTimeEntry.mockResolvedValue({
        id: 9,
        taskId: 3,
        userId: 7,
        durationMinutes: 120,
        comment: 'Проверил чертежи'
      });
      const time = await client.callTool({
        name: 'task_time_entries_create',
        arguments: {
          taskId: 3,
          taskTitle: 'Проверить',
          durationMinutes: 120,
          comment: 'Проверил чертежи',
          idempotencyKey: 'task-time-1'
        }
      });
      expect(time.isError).not.toBe(true);
      expect(tasksService.createTimeEntry).toHaveBeenCalledWith(
        3,
        { durationMinutes: 120, comment: 'Проверил чертежи' },
        7
      );
      expect(operations.run).toHaveBeenCalledWith(
        auth,
        'task_time_entries_create',
        'task-time-1',
        expect.objectContaining({ durationMinutes: 120 }),
        expect.any(Function)
      );

      for (const durationMinutes of [0, -1, 1.5, 525601]) {
        expect(
          (
            await client.callTool({
              name: 'task_time_entries_create',
              arguments: {
                taskId: 3,
                taskTitle: 'Проверить',
                durationMinutes,
                idempotencyKey: 'invalid-time'
              }
            })
          ).isError
        ).toBe(true);
      }
      expect(tasksService.createTimeEntry).toHaveBeenCalledTimes(1);
      await client.callTool({
        name: 'task_time_entries_list',
        arguments: { taskId: 3, limit: 10, beforeId: 9 }
      });
      expect(tasksService.getTimeEntries).toHaveBeenCalledWith(3, 7, {
        limit: 10,
        beforeId: 9
      });
      await client.callTool({
        name: 'tasks_personal_list',
        arguments: { scope: 'assigned', offset: 20 }
      });
      expect(tasksService.getPersonalTasks).toHaveBeenCalledWith(7, {
        scope: 'assigned',
        offset: 20,
        limit: 20
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('создаёт доску через идемпотентную MCP write-операцию', async () => {
    const auth = {
      user: { id: 7, login: 'DA', serviceNumber: '007' },
      clientId: 'jest',
      audience: PROJECTS_MCP_AUDIENCE,
      scopes: new Set(PROJECTS_MCP_SCOPES),
      accessToken: 'mcp-token'
    };
    boardsService.create.mockResolvedValue({
      id: 2,
      projectId: 1,
      title: 'Импорт Huly'
    });
    const server = service.createServer(auth);
    const client = new Client({ name: 'jest-client', version: '1.0.0' });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: 'boards_create',
      arguments: {
        projectId: 1,
        projectTitle: 'Board',
        title: 'Импорт Huly',
        idempotencyKey: 'board-create-1'
      }
    });

    expect(result.structuredContent).toEqual({
      data: { id: 2, projectId: 1, title: 'Импорт Huly' }
    });
    expect(boardsService.create).toHaveBeenCalledWith(
      1,
      {
        title: 'Импорт Huly',
        startDate: undefined,
        endDate: undefined
      },
      7
    );
    expect(operations.run).toHaveBeenCalledWith(
      auth,
      'boards_create',
      'board-create-1',
      expect.objectContaining({
        projectId: 1,
        projectTitle: 'Board',
        title: 'Импорт Huly'
      }),
      expect.any(Function)
    );

    await client.close();
    await server.close();
  });

  it('применяет DTO доски к внутреннему MCP-вызову до записи', async () => {
    const auth = {
      user: { id: 7, login: 'DA', serviceNumber: '007' },
      clientId: 'jest',
      audience: PROJECTS_MCP_AUDIENCE,
      scopes: new Set(PROJECTS_MCP_SCOPES),
      accessToken: 'mcp-token'
    };
    const server = service.createServer(auth);
    const client = new Client({ name: 'jest-client', version: '1.0.0' });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: 'boards_create',
      arguments: {
        projectId: 1,
        projectTitle: 'Board',
        title: 'Некорректный период',
        startDate: 'завтра',
        idempotencyKey: 'board-invalid-date-1'
      }
    });

    expect(result.isError).toBe(true);
    expect(boardsService.create).not.toHaveBeenCalled();

    await client.close();
    await server.close();
  });

  it('создаёт новый проект через подтверждаемую MCP-операцию', async () => {
    const auth = {
      user: { id: 7, login: 'DA', serviceNumber: '007' },
      clientId: 'jest',
      audience: PROJECTS_MCP_AUDIENCE,
      scopes: new Set(PROJECTS_MCP_SCOPES),
      accessToken: 'mcp-token'
    };
    projectsService.create.mockResolvedValue({
      id: 8,
      title: 'Новый продукт',
      prefix: 'NPR'
    });
    const server = service.createServer(auth);
    const client = new Client({ name: 'jest-client', version: '1.0.0' });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: 'projects_create',
      arguments: {
        title: 'Новый продукт',
        prefix: 'NPR',
        idempotencyKey: 'project-create-8'
      }
    });

    expect(result.structuredContent).toEqual({
      data: { id: 8, title: 'Новый продукт', prefix: 'NPR' }
    });
    expect(projectsService.create).toHaveBeenCalledWith(
      {
        title: 'Новый продукт',
        prefix: 'NPR',
        description: undefined,
        membersIds: undefined
      },
      7
    );

    await client.close();
    await server.close();
  });
});
