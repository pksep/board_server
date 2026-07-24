import { UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import { ProjectsMcpAuthGuard } from '../projects-mcp-auth.guard';

describe('ProjectsMcpAuthGuard', () => {
  const configService = {
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

  const createContext = (authorization = 'Bearer token') => {
    const request: any = {
      protocol: 'https',
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
});
