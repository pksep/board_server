import { UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import { ProjectsMcpAuthGuard } from '../projects-mcp-auth.guard';

describe('ProjectsMcpAuthGuard', () => {
  const configService: { get: jest.Mock } = {
    get: jest.fn((key: string) => {
      if (key === 'mcpProjects.audience') return 'board-projects-mcp';
      if (key === 'mcpProjects.introspectionUrl')
        return 'https://erp.example/api/auth/check';
      return undefined;
    })
  };
  const userRepository = {
    findOne: jest.fn(),
    create: jest.fn()
  };
  const guard = new ProjectsMcpAuthGuard(
    configService as any,
    userRepository as any
  );

  const createContext = (
    authorization = 'Bearer token',
    body?: Record<string, unknown>
  ) => {
    const request: any = {
      protocol: 'https',
      body,
      get: jest.fn().mockReturnValue('board.example'),
      header: jest.fn(name =>
        name === 'authorization' ? authorization : undefined
      )
    };
    const response = { setHeader: jest.fn() };
    return {
      request,
      response,
      context: {
        switchToHttp: () => ({
          getRequest: () => request,
          getResponse: () => response
        })
      } as any
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('принимает ERP token только с нужным audience и scope', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        ok: true,
        user: { id: 77, login: 'DA', tabel: '007' },
        token: {
          audience: 'board-projects-mcp',
          scopes: ['projects:read'],
          clientId: 'codex'
        }
      }
    });
    userRepository.findOne.mockResolvedValue(null);
    userRepository.create.mockResolvedValue({
      id: 7,
      erpId: '77',
      login: 'DA',
      serviceNumber: '007',
      initial: 'DA',
      image: null,
      ban: false,
      role: '-'
    });
    const { context, request } = createContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.mcpAuth).toMatchObject({
      clientId: 'codex',
      audience: 'board-projects-mcp',
      user: { id: 7, erpId: '77' }
    });
    expect(request.mcpAuth.scopes.has('projects:read')).toBe(true);
  });

  it('отклоняет обычный ERP token без MCP audience/scopes', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        ok: true,
        user: { id: 77, login: 'DA', tabel: '007' }
      }
    });
    const { context } = createContext();

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });

  it('возвращает корректный OAuth resource metadata URL при отсутствии token', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'mcpProjects.resourceUrl')
        return 'https://board.example/mcp/projects/';
      return undefined;
    });
    const { context, response } = createContext('');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Bearer resource_metadata="https://board.example/.well-known/oauth-protected-resource/mcp/projects"'
    );
  });

  it('возвращает HTTP 403 и scope challenge для запрещённого tool', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'mcpProjects.audience') return 'board-projects-mcp';
      if (key === 'mcpProjects.introspectionUrl')
        return 'https://erp.example/api/auth/check';
      return undefined;
    });
    jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        ok: true,
        user: { id: 77, login: 'DA', tabel: '007' },
        token: {
          audience: 'board-projects-mcp',
          scopes: ['projects:read'],
          clientId: 'codex'
        }
      }
    });
    userRepository.findOne.mockResolvedValue({
      id: 7,
      erpId: '77',
      login: 'DA',
      serviceNumber: '007',
      initial: 'DA',
      image: null,
      ban: false,
      role: '-'
    });
    const { context, response } = createContext('Bearer token', {
      method: 'tools/call',
      params: { name: 'projects_delete' }
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 403
    });
    expect(response.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Bearer error="insufficient_scope", scope="projects:delete"'
    );
  });
});
