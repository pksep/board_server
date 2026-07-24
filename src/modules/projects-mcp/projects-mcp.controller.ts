import { All, Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { ProjectsMcpAuthContext } from './interfaces/projects-mcp.interface';
import { PROJECTS_MCP_SCOPES } from './projects-mcp.constants';
import { ProjectsMcpAuthGuard } from './projects-mcp-auth.guard';
import { ProjectsMcpServerService } from './projects-mcp-server.service';

@Public()
@UseGuards(ProjectsMcpAuthGuard)
@Controller('mcp/projects')
export class ProjectsMcpController {
  constructor(private mcpServerService: ProjectsMcpServerService) {}

  @All()
  async handle(
    @Req() request: Request & { mcpAuth: ProjectsMcpAuthContext },
    @Res() response: Response
  ): Promise<void> {
    const server = this.mcpServerService.createServer(request.mcpAuth);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch {
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal MCP server error' },
          id: null
        });
      }
    } finally {
      response.once('close', () => {
        void transport.close();
        void server.close();
      });
    }
  }
}

@Public()
@Controller('.well-known/oauth-protected-resource/mcp/projects')
export class ProjectsMcpMetadataController {
  constructor(private configService: ConfigService) {}

  @Get()
  getMetadata(@Req() request: Request) {
    const erpApiUrl =
      this.configService.get<string>('erpApiUrl') ||
      `${request.protocol}://${request.get('host')}`;
    const authorizationServer = erpApiUrl
      .replace(/\/+$/, '')
      .replace(/\/api$/, '');
    const resource =
      this.configService.get<string>('mcpProjects.resourceUrl') ||
      `${request.protocol}://${request.get('host')}/mcp/projects`;

    return {
      resource,
      authorization_servers: [authorizationServer],
      scopes_supported: PROJECTS_MCP_SCOPES,
      bearer_methods_supported: ['header']
    };
  }
}
