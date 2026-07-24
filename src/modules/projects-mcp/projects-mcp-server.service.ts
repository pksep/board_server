import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  McpServer,
  ResourceTemplate
} from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { BoardsService } from '../boards/boards.service';
import { CreateProjectDto } from '../projects/dto/create-project.dto';
import { UpdateProjectDto } from '../projects/dto/update-project.dto';
import { ProjectAccessService } from '../projects/project-access.service';
import { ProjectsService } from '../projects/projects.service';
import { TagsService } from '../tags/tags.service';
import { ProjectsMcpScope } from './projects-mcp.constants';
import { ProjectsMcpAuthContext } from './interfaces/projects-mcp.interface';
import { ProjectsMcpOperationsService } from './projects-mcp-operations.service';

@Injectable()
export class ProjectsMcpServerService {
  constructor(
    private projectsService: ProjectsService,
    private projectAccess: ProjectAccessService,
    private boardsService: BoardsService,
    private tagsService: TagsService,
    private operations: ProjectsMcpOperationsService
  ) {}

  createServer(auth: ProjectsMcpAuthContext): McpServer {
    const server = new McpServer({
      name: 'sep-board-projects',
      version: '1.0.0'
    });

    this.registerResources(server, auth);
    this.registerReadTools(server, auth);
    this.registerWriteTools(server, auth);

    return server;
  }

  private registerResources(
    server: McpServer,
    auth: ProjectsMcpAuthContext
  ): void {
    server.registerResource(
      'accessible-projects',
      'projects://accessible',
      {
        title: 'Доступные проекты',
        description: 'Проекты, доступные текущему пользователю ERP',
        mimeType: 'application/json'
      },
      async uri => {
        this.assertScope(auth, ProjectsMcpScope.Read);
        const projects = await this.projectsService.getAll(auth.user.id);
        return this.resourceResult(uri.toString(), projects);
      }
    );

    server.registerResource(
      'project',
      new ResourceTemplate('project://{projectId}', { list: undefined }),
      {
        title: 'Проект',
        description: 'Проект по ID с обязательной объектной проверкой доступа',
        mimeType: 'application/json'
      },
      async (uri, variables) => {
        this.assertScope(auth, ProjectsMcpScope.Read);
        const projectId = this.parseProjectId(variables.projectId);
        const project = await this.projectsService.getById(
          projectId,
          auth.user.id
        );
        return this.resourceResult(uri.toString(), project);
      }
    );
  }

  private registerReadTools(
    server: McpServer,
    auth: ProjectsMcpAuthContext
  ): void {
    server.registerTool(
      'projects_list',
      {
        description: 'Получить доступные пользователю проекты с поиском',
        inputSchema: {
          search: z.string().trim().max(200).optional()
        },
        annotations: this.readOnlyAnnotations('Список проектов')
      },
      async ({ search }) => {
        this.assertScope(auth, ProjectsMcpScope.Read);
        const projects = await this.projectsService.getAll(auth.user.id);
        const query = search?.toLocaleLowerCase('ru');
        const result = query
          ? projects.filter(project =>
              [project.title, project.prefix, project.description]
                .filter(Boolean)
                .some(value => value.toLocaleLowerCase('ru').includes(query))
            )
          : projects;
        return this.toolResult(result);
      }
    );

    server.registerTool(
      'projects_get',
      {
        description: 'Получить проект по ID',
        inputSchema: { projectId: z.number().int().positive() },
        annotations: this.readOnlyAnnotations('Получить проект')
      },
      async ({ projectId }) => {
        this.assertScope(auth, ProjectsMcpScope.Read);
        return this.toolResult(
          await this.projectsService.getById(projectId, auth.user.id)
        );
      }
    );

    server.registerTool(
      'project_members_list',
      {
        description: 'Получить участников проекта',
        inputSchema: { projectId: z.number().int().positive() },
        annotations: this.readOnlyAnnotations('Участники проекта')
      },
      async ({ projectId }) => {
        this.assertScope(auth, ProjectsMcpScope.Read);
        const project = await this.projectsService.getById(
          projectId,
          auth.user.id
        );
        return this.toolResult(project.members || []);
      }
    );

    server.registerTool(
      'project_boards_list',
      {
        description: 'Получить доски проекта',
        inputSchema: { projectId: z.number().int().positive() },
        annotations: this.readOnlyAnnotations('Доски проекта')
      },
      async ({ projectId }) => {
        this.assertScope(auth, ProjectsMcpScope.Read);
        await this.projectAccess.assertCanRead(projectId, auth.user.id);
        return this.toolResult(
          await this.boardsService.getByProject(projectId)
        );
      }
    );

    server.registerTool(
      'project_tags_list',
      {
        description: 'Получить теги проекта',
        inputSchema: { projectId: z.number().int().positive() },
        annotations: this.readOnlyAnnotations('Теги проекта')
      },
      async ({ projectId }) => {
        this.assertScope(auth, ProjectsMcpScope.Read);
        await this.projectAccess.assertCanRead(projectId, auth.user.id);
        return this.toolResult(await this.tagsService.getByProject(projectId));
      }
    );
  }

  private registerWriteTools(
    server: McpServer,
    auth: ProjectsMcpAuthContext
  ): void {
    const idempotencyKey = z
      .string()
      .trim()
      .min(8)
      .max(128)
      .describe('Стабильный уникальный ключ повторного вызова');

    server.registerTool(
      'projects_create',
      {
        description: 'Создать проект',
        inputSchema: {
          title: z.string().trim().min(1).max(255),
          prefix: z
            .string()
            .trim()
            .regex(/^[A-Za-z]{3,10}$/),
          description: z.string().max(10000).optional(),
          membersIds: z.array(z.number().int().positive()).max(500).optional(),
          idempotencyKey
        },
        annotations: this.writeAnnotations('Создать проект')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Create);
        if (input.membersIds?.length) {
          this.assertScope(auth, ProjectsMcpScope.Members);
        }
        return this.toolResult(
          await this.operations.run(
            auth,
            'projects_create',
            input.idempotencyKey,
            input,
            async () => {
              const project = await this.projectsService.create(
                {
                  title: input.title,
                  prefix: input.prefix,
                  description: input.description,
                  membersIds: input.membersIds
                } as CreateProjectDto,
                auth.user.id
              );
              return { value: this.toPlain(project), projectId: project.id };
            }
          )
        );
      }
    );

    server.registerTool(
      'projects_update',
      {
        description: 'Изменить название или описание проекта',
        inputSchema: {
          projectId: z.number().int().positive(),
          title: z.string().trim().min(1).max(255).optional(),
          description: z.string().max(10000).optional(),
          idempotencyKey
        },
        annotations: this.writeAnnotations('Изменить проект')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Update);
        return this.toolResult(
          await this.operations.run(
            auth,
            'projects_update',
            input.idempotencyKey,
            input,
            async () => ({
              value: this.toPlain(
                await this.projectsService.update(
                  {
                    id: input.projectId,
                    title: input.title,
                    description: input.description
                  } as UpdateProjectDto,
                  auth.user.id
                )
              ),
              projectId: input.projectId
            })
          )
        );
      }
    );

    server.registerTool(
      'project_members_update',
      {
        description: 'Полностью заменить список участников проекта',
        inputSchema: {
          projectId: z.number().int().positive(),
          membersIds: z.array(z.number().int().positive()).max(500),
          idempotencyKey
        },
        annotations: this.writeAnnotations('Изменить участников')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Members);
        return this.toolResult(
          await this.operations.run(
            auth,
            'project_members_update',
            input.idempotencyKey,
            input,
            async () => ({
              value: this.toPlain(
                await this.projectsService.update(
                  {
                    id: input.projectId,
                    membersIds: input.membersIds
                  } as UpdateProjectDto,
                  auth.user.id
                )
              ),
              projectId: input.projectId
            })
          )
        );
      }
    );

    server.registerTool(
      'projects_delete',
      {
        description:
          'Мягко удалить проект. Требуется явное подтверждение confirm=true',
        inputSchema: {
          projectId: z.number().int().positive(),
          confirm: z.literal(true),
          idempotencyKey
        },
        annotations: {
          title: 'Удалить проект',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false
        }
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Delete);
        return this.toolResult(
          await this.operations.run(
            auth,
            'projects_delete',
            input.idempotencyKey,
            input,
            async () => {
              await this.projectsService.delete(input.projectId, auth.user.id);
              return {
                value: { deleted: true, projectId: input.projectId },
                projectId: input.projectId
              };
            }
          )
        );
      }
    );
  }

  private assertScope(
    auth: ProjectsMcpAuthContext,
    scope: ProjectsMcpScope
  ): void {
    if (!auth.scopes.has(scope)) {
      throw new ForbiddenException(`Недостаточный scope: ${scope}`);
    }
  }

  private parseProjectId(value: string | string[]): number {
    const projectId = Number(Array.isArray(value) ? value[0] : value);
    if (!Number.isInteger(projectId) || projectId < 1) {
      throw new Error('Некорректный ID проекта');
    }
    return projectId;
  }

  private readOnlyAnnotations(title: string) {
    return {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    };
  }

  private writeAnnotations(title: string) {
    return {
      title,
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    };
  }

  private toolResult(value: unknown) {
    const plain = this.toPlain(value);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(plain)
        }
      ],
      structuredContent: { data: plain }
    };
  }

  private resourceResult(uri: string, value: unknown) {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(this.toPlain(value))
        }
      ]
    };
  }

  private toPlain(value: any): any {
    if (Array.isArray(value)) return value.map(item => this.toPlain(item));
    if (value && typeof value.toJSON === 'function') return value.toJSON();
    return value;
  }
}
