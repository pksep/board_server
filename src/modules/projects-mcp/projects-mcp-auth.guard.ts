import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import axios from 'axios';
import { Request, Response } from 'express';
import { User } from 'src/modules/users/model/users.model';
import {
  PROJECTS_MCP_AUDIENCE,
  PROJECTS_MCP_SCOPES,
  PROJECTS_MCP_TOOL_SCOPES,
  ProjectsMcpScope
} from './projects-mcp.constants';
import { ProjectsMcpAuthContext } from './interfaces/projects-mcp.interface';

type ErpTokenCheckResponse = {
  ok?: boolean;
  user?: {
    id: number | string;
    login?: string;
    initial?: string;
    tabel?: string;
    serviceNumber?: string;
    image?: string | null;
    ban?: boolean;
    role?: string;
  };
  token?: {
    audience?: string | string[];
    scopes?: string[];
    clientId?: string;
    expiresAt?: number;
  };
};

@Injectable()
export class ProjectsMcpAuthGuard implements CanActivate {
  constructor(
    private configService: ConfigService,
    @InjectModel(User) private userRepository: typeof User
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const resourceUrl =
      this.configService.get<string>('mcpProjects.resourceUrl') ||
      `${request.protocol}://${request.get('host')}/mcp/projects`;
    const normalizedResourceUrl = resourceUrl.replace(/\/+$/, '');
    const resource = new URL(normalizedResourceUrl);
    const resourceMetadataUrl = `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`;

    const authorization = request.header('authorization');
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      this.setAuthenticateHeader(response, resourceMetadataUrl);
      throw new UnauthorizedException('Требуется Bearer token');
    }

    const introspectionUrl = this.getIntrospectionUrl();
    let data: ErpTokenCheckResponse;

    try {
      const result = await axios.post<ErpTokenCheckResponse>(
        introspectionUrl,
        { token: match[1] },
        { timeout: 5000 }
      );
      data = result.data;
    } catch {
      this.setAuthenticateHeader(response, resourceMetadataUrl);
      throw new UnauthorizedException('ERP отклонил MCP token');
    }

    const expectedAudience =
      this.configService.get<string>('mcpProjects.audience') ||
      PROJECTS_MCP_AUDIENCE;
    const audiences = Array.isArray(data.token?.audience)
      ? data.token.audience
      : [data.token?.audience].filter(Boolean);
    const scopes = new Set(data.token?.scopes || []);

    if (
      !data.ok ||
      !data.user ||
      data.user.ban ||
      !audiences.includes(expectedAudience) ||
      !PROJECTS_MCP_SCOPES.some(scope => scopes.has(scope))
    ) {
      this.setAuthenticateHeader(response, resourceMetadataUrl);
      throw new UnauthorizedException(
        'MCP token имеет неверный audience или scopes'
      );
    }

    this.assertRequestScope(request, response, scopes);
    const user = await this.upsertBoardUser(data.user);
    const auth: ProjectsMcpAuthContext = {
      user: {
        id: user.id,
        erpId: user.erpId,
        login: user.login,
        serviceNumber: user.serviceNumber,
        initial: user.initial,
        role: user.role
      },
      clientId: data.token?.clientId || 'unknown-mcp-client',
      audience: expectedAudience,
      scopes,
      tokenExpiresAt: data.token?.expiresAt
    };

    (request as Request & { mcpAuth: ProjectsMcpAuthContext }).mcpAuth = auth;
    return true;
  }

  private assertRequestScope(
    request: Request,
    response: Response,
    scopes: Set<string>
  ): void {
    const body = request.body as
      | {
          method?: unknown;
          params?: { name?: unknown };
        }
      | undefined;
    let requiredScope: ProjectsMcpScope | undefined;

    if (
      body?.method === 'tools/call' &&
      typeof body.params?.name === 'string'
    ) {
      requiredScope = PROJECTS_MCP_TOOL_SCOPES[body.params.name];
    } else if (
      body?.method === 'resources/read' ||
      body?.method === 'resources/list'
    ) {
      requiredScope = ProjectsMcpScope.Read;
    }

    if (requiredScope && !scopes.has(requiredScope)) {
      response.setHeader(
        'WWW-Authenticate',
        `Bearer error="insufficient_scope", scope="${requiredScope}"`
      );
      throw new ForbiddenException(`Недостаточный scope: ${requiredScope}`);
    }
  }

  private setAuthenticateHeader(
    response: Response,
    resourceMetadataUrl: string
  ): void {
    response.setHeader(
      'WWW-Authenticate',
      `Bearer resource_metadata="${resourceMetadataUrl}"`
    );
  }

  private getIntrospectionUrl(): string {
    const explicit = this.configService.get<string>(
      'mcpProjects.introspectionUrl'
    );
    if (explicit) return explicit;

    const erpApiUrl = this.configService.get<string>('erpApiUrl');
    if (!erpApiUrl) {
      throw new UnauthorizedException('ERP_API_URL не настроен');
    }

    const normalized = erpApiUrl.replace(/\/+$/, '');
    const apiBase = normalized.endsWith('/api')
      ? normalized
      : `${normalized}/api`;
    return `${apiBase}/auth/check`;
  }

  private async upsertBoardUser(
    erpUser: NonNullable<ErpTokenCheckResponse['user']>
  ): Promise<User> {
    const erpId = String(erpUser.id);
    const values = {
      initial: erpUser.initial || erpUser.login || `user-${erpId}`,
      login: erpUser.login || `user-${erpId}`,
      serviceNumber:
        erpUser.tabel || erpUser.serviceNumber || String(erpUser.id),
      image: erpUser.image || null,
      ban: erpUser.ban ?? false,
      role: erpUser.role || '-'
    };
    const existing = await this.userRepository.findOne({ where: { erpId } });

    if (existing) {
      const hasChanges = Object.entries(values).some(
        ([key, value]) => existing[key] !== value
      );
      if (hasChanges) await existing.update(values);
      return existing;
    }

    return this.userRepository.create({ erpId, ...values } as any);
  }
}
