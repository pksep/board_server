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
    getById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
  };
  const projectAccess = {
    assertCanRead: jest.fn()
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
    create: jest.fn(),
    createSubtask: jest.fn(),
    update: jest.fn(),
    move: jest.fn(),
    delete: jest.fn()
  };
  const tagsService = {
    getByProject: jest.fn()
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
        'projects_create',
        'projects_delete',
        'projects_get',
        'projects_list',
        'projects_update',
        'subtasks_create',
        'task_comments_create',
        'task_comments_list',
        'task_subtasks_list',
        'tasks_create',
        'tasks_delete',
        'tasks_get',
        'tasks_move',
        'tasks_update'
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
        title: 'Импорт Huly'
      }),
      expect.any(Function)
    );

    await client.close();
    await server.close();
  });
});
