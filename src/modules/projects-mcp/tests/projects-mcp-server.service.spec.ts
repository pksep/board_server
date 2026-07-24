import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ProjectsMcpServerService } from '../projects-mcp-server.service';
import {
  PROJECTS_MCP_SCOPES,
  PROJECTS_MCP_AUDIENCE
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
    getByProject: jest.fn().mockResolvedValue([])
  };
  const tagsService = {
    getByProject: jest.fn()
  };
  const operations = {
    run: jest.fn()
  };
  const service = new ProjectsMcpServerService(
    projectsService as any,
    projectAccess as any,
    boardsService as any,
    tagsService as any,
    operations as any
  );

  it('публикует полный набор типизированных tools стандартному MCP-клиенту', async () => {
    const server = service.createServer({
      user: { id: 7, login: 'DA', serviceNumber: '007' },
      clientId: 'jest',
      audience: PROJECTS_MCP_AUDIENCE,
      scopes: new Set(PROJECTS_MCP_SCOPES)
    });
    const client = new Client({ name: 'jest-client', version: '1.0.0' });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.listTools();
    expect(result.tools.map(tool => tool.name).sort()).toEqual(
      [
        'project_boards_list',
        'project_members_list',
        'project_members_update',
        'project_tags_list',
        'projects_create',
        'projects_delete',
        'projects_get',
        'projects_list',
        'projects_update'
      ].sort()
    );

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

    await client.close();
    await server.close();
  });
});
