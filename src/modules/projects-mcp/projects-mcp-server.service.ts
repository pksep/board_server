import {
  BadRequestException,
  ForbiddenException,
  Injectable
} from '@nestjs/common';
import {
  McpServer,
  ResourceTemplate
} from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { BoardsService } from '../boards/boards.service';
import { CreateBoardDto } from '../boards/dto/create-board.dto';
import { ReorderBoardsDto } from '../boards/dto/reorder-boards.dto';
import { UpdateBoardDto } from '../boards/dto/update-board.dto';
import { ColumnsService } from '../columns/columns.service';
import { CreateColumnDto } from '../columns/dto/create-column.dto';
import { ReorderColumnsDto } from '../columns/dto/reorder-columns.dto';
import { UpdateColumnDto } from '../columns/dto/update-column.dto';
import { ActivityHistoryQueryDto } from '../activity-events/dto/activity-history-query.dto';
import { CreateProjectDto } from '../projects/dto/create-project.dto';
import { ReorderProjectsDto } from '../projects/dto/reorder-projects.dto';
import { UpdateProjectDto } from '../projects/dto/update-project.dto';
import { ProjectAccessService } from '../projects/project-access.service';
import { ProjectsService } from '../projects/projects.service';
import { TagsService } from '../tags/tags.service';
import { CreateTagDto } from '../tags/dto/create-tag.dto';
import { UpdateTagDto } from '../tags/dto/update-tag.dto';
import { CreateTaskDto } from '../tasks/dto/create-task.dto';
import { MoveTaskDto } from '../tasks/dto/move-task.dto';
import { UpdateTaskDto } from '../tasks/dto/update-task.dto';
import { TasksService } from '../tasks/tasks.service';
import { UsersService } from '../users/users.service';
import { validateDto } from '../../utils/validation/validate-dto';
import { ProjectsMcpScope } from './projects-mcp.constants';
import { ProjectsMcpAuthContext } from './interfaces/projects-mcp.interface';
import { ProjectsMcpOperationsService } from './projects-mcp-operations.service';
import { ProjectsMcpTaskCommentsService } from './projects-mcp-task-comments.service';

@Injectable()
export class ProjectsMcpServerService {
  constructor(
    private projectsService: ProjectsService,
    private projectAccess: ProjectAccessService,
    private boardsService: BoardsService,
    private columnsService: ColumnsService,
    private tasksService: TasksService,
    private tagsService: TagsService,
    private usersService: UsersService,
    private operations: ProjectsMcpOperationsService,
    private taskComments: ProjectsMcpTaskCommentsService
  ) {}

  createServer(auth: ProjectsMcpAuthContext): McpServer {
    const server = new McpServer({
      name: 'sep-board-projects',
      version: '1.0.0'
    });

    this.registerResources(server, auth);
    this.registerReadTools(server, auth);
    this.registerWriteTools(server, auth);
    this.registerBoardAndTaskReadTools(server, auth);
    this.registerBoardAndTaskWriteTools(server, auth);

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
      'users_list',
      {
        description:
          'Получить пользователей доски для выбора участников и исполнителей по имени',
        inputSchema: {
          search: z.string().trim().max(200).optional()
        },
        annotations: this.readOnlyAnnotations('Пользователи доски')
      },
      async ({ search }) => {
        this.assertScope(auth, ProjectsMcpScope.Read);
        const users = await this.usersService.getUsersList();
        const query = search?.toLocaleLowerCase('ru-RU');
        const result = query
          ? users.filter(user =>
              [user.initial, user.login, user.serviceNumber]
                .filter(Boolean)
                .some(value =>
                  String(value).toLocaleLowerCase('ru-RU').includes(query)
                )
            )
          : users;
        return this.toolResult(result);
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
          await this.boardsService.getByProject(projectId, auth.user.id)
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
    const title = z.string().trim().min(1).max(255);
    const names = z.array(title).max(500);
    const ids = z
      .array(z.number().int().positive())
      .max(500)
      .refine(values => new Set(values).size === values.length, {
        message: 'ID не должны повторяться'
      });

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
          membersIds: ids.optional(),
          memberNames: names.optional(),
          idempotencyKey
        },
        annotations: this.writeAnnotations('Создать проект')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Create);
        if (input.membersIds?.length) {
          this.assertScope(auth, ProjectsMcpScope.Members);
        }
        await this.assertNamedUsers(input.membersIds, input.memberNames);
        return this.toolResult(
          await this.operations.run(
            auth,
            'projects_create',
            input.idempotencyKey,
            input,
            async () => {
              const dto = await validateDto(CreateProjectDto, {
                title: input.title,
                prefix: input.prefix,
                description: input.description,
                membersIds: input.membersIds
              });
              const project = await this.projectsService.create(
                dto,
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
          projectTitle: title.describe('Текущее точное название проекта'),
          title: z.string().trim().min(1).max(255).optional(),
          description: z.string().max(10000).optional(),
          idempotencyKey
        },
        annotations: this.writeAnnotations('Изменить проект')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Update);
        this.assertAnyDefined(input, ['title', 'description']);
        return this.toolResult(
          await this.operations.run(
            auth,
            'projects_update',
            input.idempotencyKey,
            input,
            async () => {
              await this.assertProjectTitle(
                input.projectId,
                auth.user.id,
                input.projectTitle
              );
              return {
                value: this.toPlain(
                  await this.projectsService.update(
                    await validateDto(UpdateProjectDto, {
                      id: input.projectId,
                      title: input.title,
                      description: input.description
                    }),
                    auth.user.id
                  )
                ),
                projectId: input.projectId
              };
            }
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
          projectTitle: title.describe('Текущее точное название проекта'),
          membersIds: ids,
          memberNames: names,
          idempotencyKey
        },
        annotations: this.writeAnnotations('Изменить участников')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Members);
        await this.assertNamedUsers(input.membersIds, input.memberNames);
        return this.toolResult(
          await this.operations.run(
            auth,
            'project_members_update',
            input.idempotencyKey,
            input,
            async () => {
              await this.assertProjectTitle(
                input.projectId,
                auth.user.id,
                input.projectTitle
              );
              return {
                value: this.toPlain(
                  await this.projectsService.update(
                    await validateDto(UpdateProjectDto, {
                      id: input.projectId,
                      membersIds: input.membersIds
                    }),
                    auth.user.id
                  )
                ),
                projectId: input.projectId
              };
            }
          )
        );
      }
    );

    server.registerTool(
      'projects_favorite_set',
      {
        description: 'Добавить проект в избранное или убрать из избранного',
        inputSchema: {
          projectId: z.number().int().positive(),
          projectTitle: title.describe('Точное название проекта'),
          isFavorite: z.boolean(),
          idempotencyKey
        },
        annotations: this.writeAnnotations('Изменить избранное')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Update);
        return this.toolResult(
          await this.operations.run(
            auth,
            'projects_favorite_set',
            input.idempotencyKey,
            input,
            async () => {
              const projects = await this.projectsService.getAll(auth.user.id);
              const project = projects.find(
                item => item.id === input.projectId
              );
              this.assertEntityTitle(
                project?.title,
                input.projectTitle,
                'проекта'
              );
              const current = Boolean((project as any)?.favorites?.length);
              const value =
                current === input.isFavorite
                  ? { isFavorite: current }
                  : await this.projectsService.toggleFavorite(
                      input.projectId,
                      auth.user.id
                    );
              return { value, projectId: input.projectId };
            }
          )
        );
      }
    );

    server.registerTool(
      'projects_reorder',
      {
        description: 'Задать полный персональный порядок проектов',
        inputSchema: {
          projectIds: ids.min(1),
          projectTitles: names.min(1),
          idempotencyKey
        },
        annotations: this.writeAnnotations('Изменить порядок проектов')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Update);
        return this.toolResult(
          await this.operations.run(
            auth,
            'projects_reorder',
            input.idempotencyKey,
            input,
            async () => {
              const projects = await this.projectsService.getAll(auth.user.id);
              this.assertNamedOrder(
                projects,
                input.projectIds,
                input.projectTitles,
                'проектов'
              );
              const dto = await validateDto(ReorderProjectsDto, {
                ids: input.projectIds
              });
              await this.projectsService.reorder(dto.ids, auth.user.id);
              return {
                value: { reordered: true, projectTitles: input.projectTitles }
              };
            }
          )
        );
      }
    );

    server.registerTool(
      'project_tags_create',
      {
        description: 'Создать тег в проекте',
        inputSchema: {
          projectId: z.number().int().positive(),
          projectTitle: title.describe('Точное название проекта'),
          label: title,
          color: z.string().trim().min(1).max(64),
          description: z.string().max(10000).optional(),
          idempotencyKey
        },
        annotations: this.writeAnnotations('Создать тег')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Update);
        return this.toolResult(
          await this.operations.run(
            auth,
            'project_tags_create',
            input.idempotencyKey,
            input,
            async () => {
              await this.projectAccess.assertCanManage(
                input.projectId,
                auth.user.id
              );
              await this.assertProjectTitle(
                input.projectId,
                auth.user.id,
                input.projectTitle
              );
              const tag = await this.tagsService.create(
                input.projectId,
                await validateDto(CreateTagDto, {
                  label: input.label,
                  color: input.color,
                  description: input.description
                })
              );
              return { value: this.toPlain(tag), projectId: input.projectId };
            }
          )
        );
      }
    );

    server.registerTool(
      'project_tags_update',
      {
        description: 'Изменить тег проекта',
        inputSchema: {
          projectId: z.number().int().positive(),
          projectTitle: title.describe('Точное название проекта'),
          tagId: z.number().int().positive(),
          tagLabel: title.describe('Текущее точное название тега'),
          label: title.optional(),
          color: z.string().trim().min(1).max(64).optional(),
          description: z.string().max(10000).optional(),
          idempotencyKey
        },
        annotations: this.writeAnnotations('Изменить тег')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Update);
        this.assertAnyDefined(input, ['label', 'color', 'description']);
        return this.toolResult(
          await this.operations.run(
            auth,
            'project_tags_update',
            input.idempotencyKey,
            input,
            async () => {
              await this.projectAccess.assertCanManage(
                input.projectId,
                auth.user.id
              );
              await this.assertProjectTitle(
                input.projectId,
                auth.user.id,
                input.projectTitle
              );
              await this.assertTagTitle(
                input.projectId,
                input.tagId,
                input.tagLabel
              );
              const tag = await this.tagsService.update(
                input.tagId,
                await validateDto(UpdateTagDto, {
                  label: input.label,
                  color: input.color,
                  description: input.description
                })
              );
              return { value: this.toPlain(tag), projectId: input.projectId };
            }
          )
        );
      }
    );

    server.registerTool(
      'project_tags_delete',
      {
        description: 'Мягко удалить тег проекта с явным подтверждением',
        inputSchema: {
          projectId: z.number().int().positive(),
          projectTitle: title.describe('Точное название проекта'),
          tagId: z.number().int().positive(),
          tagLabel: title.describe('Точное название тега'),
          confirm: z.literal(true),
          idempotencyKey
        },
        annotations: this.destructiveAnnotations('Удалить тег')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Delete);
        return this.toolResult(
          await this.operations.run(
            auth,
            'project_tags_delete',
            input.idempotencyKey,
            input,
            async () => {
              await this.projectAccess.assertCanManage(
                input.projectId,
                auth.user.id
              );
              await this.assertProjectTitle(
                input.projectId,
                auth.user.id,
                input.projectTitle
              );
              await this.assertTagTitle(
                input.projectId,
                input.tagId,
                input.tagLabel
              );
              await this.tagsService.delete(input.tagId);
              return {
                value: { deleted: true, tagLabel: input.tagLabel },
                projectId: input.projectId
              };
            }
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
          projectTitle: title.describe('Точное название проекта'),
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
              await this.assertProjectTitle(
                input.projectId,
                auth.user.id,
                input.projectTitle
              );
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

  private registerBoardAndTaskReadTools(
    server: McpServer,
    auth: ProjectsMcpAuthContext
  ): void {
    server.registerTool(
      'boards_get',
      {
        description: 'Получить доску с колонками по ID',
        inputSchema: { boardId: z.number().int().positive() },
        annotations: this.readOnlyAnnotations('Получить доску')
      },
      async ({ boardId }) => {
        this.assertScope(auth, ProjectsMcpScope.Read);
        return this.toolResult(
          await this.boardsService.getById(boardId, auth.user.id)
        );
      }
    );

    server.registerTool(
      'board_columns_list',
      {
        description: 'Получить упорядоченные колонки доски',
        inputSchema: { boardId: z.number().int().positive() },
        annotations: this.readOnlyAnnotations('Колонки доски')
      },
      async ({ boardId }) => {
        this.assertScope(auth, ProjectsMcpScope.Read);
        return this.toolResult(
          await this.columnsService.getByBoard(boardId, auth.user.id)
        );
      }
    );

    server.registerTool(
      'board_tasks_list',
      {
        description: 'Получить верхнеуровневые задачи доски с подзадачами',
        inputSchema: { boardId: z.number().int().positive() },
        annotations: this.readOnlyAnnotations('Задачи доски')
      },
      async ({ boardId }) => {
        this.assertScope(auth, ProjectsMcpScope.Read);
        return this.toolResult(
          await this.tasksService.getByBoard(boardId, auth.user.id)
        );
      }
    );

    server.registerTool(
      'columns_get',
      {
        description: 'Получить колонку по ID',
        inputSchema: { columnId: z.number().int().positive() },
        annotations: this.readOnlyAnnotations('Получить колонку')
      },
      async ({ columnId }) => {
        this.assertScope(auth, ProjectsMcpScope.Read);
        return this.toolResult(
          await this.columnsService.getById(columnId, auth.user.id)
        );
      }
    );

    server.registerTool(
      'column_tasks_list',
      {
        description: 'Получить верхнеуровневые задачи колонки с подзадачами',
        inputSchema: { columnId: z.number().int().positive() },
        annotations: this.readOnlyAnnotations('Задачи колонки')
      },
      async ({ columnId }) => {
        this.assertScope(auth, ProjectsMcpScope.Read);
        return this.toolResult(
          await this.tasksService.getByColumn(columnId, auth.user.id)
        );
      }
    );

    server.registerTool(
      'tasks_get',
      {
        description: 'Получить задачу или подзадачу по ID',
        inputSchema: { taskId: z.number().int().positive() },
        annotations: this.readOnlyAnnotations('Получить задачу')
      },
      async ({ taskId }) => {
        this.assertScope(auth, ProjectsMcpScope.Read);
        return this.toolResult(
          await this.tasksService.getById(taskId, auth.user.id)
        );
      }
    );

    server.registerTool(
      'task_subtasks_list',
      {
        description: 'Получить непосредственные подзадачи задачи',
        inputSchema: { taskId: z.number().int().positive() },
        annotations: this.readOnlyAnnotations('Подзадачи')
      },
      async ({ taskId }) => {
        this.assertScope(auth, ProjectsMcpScope.Read);
        return this.toolResult(
          await this.tasksService.getSubtasks(taskId, auth.user.id)
        );
      }
    );

    server.registerTool(
      'task_comments_list',
      {
        description: 'Получить комментарии задачи из ERP comments service',
        inputSchema: {
          taskId: z.number().int().positive(),
          page: z.number().int().nonnegative().default(0),
          limit: z.number().int().positive().max(100).default(20)
        },
        annotations: this.readOnlyAnnotations('Комментарии задачи')
      },
      async ({ taskId, page, limit }) => {
        this.assertScope(auth, ProjectsMcpScope.Read);
        return this.toolResult(
          await this.taskComments.list(taskId, page, limit, auth)
        );
      }
    );

    server.registerTool(
      'task_history_list',
      {
        description: 'Получить историю изменений задачи',
        inputSchema: {
          taskId: z.number().int().positive(),
          limit: z.number().int().positive().max(100).default(50),
          beforeId: z.number().int().positive().optional()
        },
        annotations: this.readOnlyAnnotations('История задачи')
      },
      async ({ taskId, limit, beforeId }) => {
        this.assertScope(auth, ProjectsMcpScope.Read);
        const query = await validateDto(ActivityHistoryQueryDto, {
          limit,
          beforeId
        });
        return this.toolResult(
          await this.tasksService.getHistory(taskId, auth.user.id, query)
        );
      }
    );
  }

  private registerBoardAndTaskWriteTools(
    server: McpServer,
    auth: ProjectsMcpAuthContext
  ): void {
    const idempotencyKey = z
      .string()
      .trim()
      .min(8)
      .max(128)
      .describe('Стабильный уникальный ключ повторного вызова');
    const title = z.string().trim().min(1).max(255);
    const date = z.string().trim().min(1).max(64);
    const ids = z
      .array(z.number().int().positive())
      .min(1)
      .max(1000)
      .refine(values => new Set(values).size === values.length, {
        message: 'ID не должны повторяться'
      });
    const titles = z.array(title).min(1).max(1000);
    const taskCreateFields = {
      title,
      description: z.string().max(200000).optional(),
      priority: z.enum(['', 'low', 'medium', 'high', 'urgent']).optional(),
      dueDate: date.optional(),
      assigneeIds: z.array(z.number().int().positive()).max(500).optional(),
      assigneeNames: z.array(title).max(500).optional(),
      tagIds: z.array(z.number().int().positive()).max(500).optional(),
      tagLabels: z.array(title).max(500).optional(),
      approvalStatus: z.enum(['', 'yes', 'no']).optional()
    };
    const taskUpdateFields = {
      title: title.optional(),
      description: z.string().max(200000).optional(),
      priority: z.enum(['', 'low', 'medium', 'high', 'urgent']).optional(),
      dueDate: date.optional(),
      assigneeIds: z.array(z.number().int().positive()).max(500).optional(),
      assigneeNames: z.array(title).max(500).optional(),
      tagIds: z.array(z.number().int().positive()).max(500).optional(),
      tagLabels: z.array(title).max(500).optional(),
      approvalStatus: z.enum(['', 'yes', 'no']).optional(),
      parentTaskId: z.null().optional()
    };

    server.registerTool(
      'boards_create',
      {
        description: 'Создать доску в проекте',
        inputSchema: {
          projectId: z.number().int().positive(),
          projectTitle: title.describe('Точное название проекта'),
          title,
          startDate: date.optional(),
          endDate: date.optional(),
          idempotencyKey
        },
        annotations: this.writeAnnotations('Создать доску')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Update);
        return this.toolResult(
          await this.operations.run(
            auth,
            'boards_create',
            input.idempotencyKey,
            input,
            async () => {
              await this.assertProjectTitle(
                input.projectId,
                auth.user.id,
                input.projectTitle
              );
              const dto = await validateDto(CreateBoardDto, {
                title: input.title,
                startDate: input.startDate,
                endDate: input.endDate
              });
              const board = await this.boardsService.create(
                input.projectId,
                dto,
                auth.user.id
              );
              return {
                value: this.toPlain(board),
                projectId: input.projectId
              };
            }
          )
        );
      }
    );

    server.registerTool(
      'boards_update',
      {
        description: 'Изменить название или период доски',
        inputSchema: {
          boardId: z.number().int().positive(),
          boardTitle: title.describe('Текущее точное название доски'),
          title: title.optional(),
          startDate: date.optional(),
          endDate: date.optional(),
          idempotencyKey
        },
        annotations: this.writeAnnotations('Изменить доску')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Update);
        this.assertAnyDefined(input, ['title', 'startDate', 'endDate']);
        return this.toolResult(
          await this.operations.run(
            auth,
            'boards_update',
            input.idempotencyKey,
            input,
            async () => {
              const current = await this.boardsService.getById(
                input.boardId,
                auth.user.id
              );
              this.assertEntityTitle(current.title, input.boardTitle, 'доски');
              const board = await this.boardsService.update(
                input.boardId,
                await validateDto(UpdateBoardDto, {
                  title: input.title,
                  startDate: input.startDate,
                  endDate: input.endDate
                }),
                auth.user.id
              );
              return {
                value: this.toPlain(board),
                projectId: board.projectId
              };
            }
          )
        );
      }
    );

    server.registerTool(
      'boards_reorder',
      {
        description: 'Задать полный порядок досок проекта',
        inputSchema: {
          projectId: z.number().int().positive(),
          projectTitle: title.describe('Точное название проекта'),
          boardIds: ids,
          boardTitles: titles,
          idempotencyKey
        },
        annotations: this.writeAnnotations('Изменить порядок досок')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Update);
        return this.toolResult(
          await this.operations.run(
            auth,
            'boards_reorder',
            input.idempotencyKey,
            input,
            async () => {
              await this.assertProjectTitle(
                input.projectId,
                auth.user.id,
                input.projectTitle
              );
              const boards = await this.boardsService.getByProject(
                input.projectId,
                auth.user.id
              );
              this.assertNamedOrder(
                boards,
                input.boardIds,
                input.boardTitles,
                'досок проекта'
              );
              const dto = await validateDto(ReorderBoardsDto, {
                ids: input.boardIds
              });
              await this.boardsService.reorder(
                input.projectId,
                dto.ids,
                auth.user.id
              );
              return {
                value: {
                  reordered: true,
                  projectId: input.projectId,
                  boardIds: input.boardIds
                },
                projectId: input.projectId
              };
            }
          )
        );
      }
    );

    server.registerTool(
      'boards_delete',
      {
        description: 'Мягко удалить доску с явным подтверждением',
        inputSchema: {
          boardId: z.number().int().positive(),
          boardTitle: title.describe('Точное название доски'),
          confirm: z.literal(true),
          idempotencyKey
        },
        annotations: this.destructiveAnnotations('Удалить доску')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Delete);
        return this.toolResult(
          await this.operations.run(
            auth,
            'boards_delete',
            input.idempotencyKey,
            input,
            async () => {
              const board = await this.boardsService.getById(
                input.boardId,
                auth.user.id
              );
              this.assertEntityTitle(board.title, input.boardTitle, 'доски');
              await this.boardsService.delete(input.boardId, auth.user.id);
              return {
                value: { deleted: true, boardId: input.boardId },
                projectId: board.projectId
              };
            }
          )
        );
      }
    );

    server.registerTool(
      'columns_create',
      {
        description: 'Создать колонку в доске',
        inputSchema: {
          boardId: z.number().int().positive(),
          boardTitle: title.describe('Точное название доски'),
          title,
          color: z.string().trim().max(64).optional(),
          idempotencyKey
        },
        annotations: this.writeAnnotations('Создать колонку')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Update);
        this.assertAnyDefined(input, ['title', 'color']);
        return this.toolResult(
          await this.operations.run(
            auth,
            'columns_create',
            input.idempotencyKey,
            input,
            async () => {
              const board = await this.boardsService.getById(
                input.boardId,
                auth.user.id
              );
              this.assertEntityTitle(board.title, input.boardTitle, 'доски');
              const column = await this.columnsService.create(
                input.boardId,
                await validateDto(CreateColumnDto, {
                  title: input.title,
                  color: input.color
                }),
                auth.user.id
              );
              return {
                value: this.toPlain(column),
                projectId: board.projectId
              };
            }
          )
        );
      }
    );

    server.registerTool(
      'columns_update',
      {
        description: 'Изменить название или цвет колонки',
        inputSchema: {
          columnId: z.number().int().positive(),
          columnTitle: title.describe('Текущее точное название колонки'),
          title: title.optional(),
          color: z.string().trim().max(64).optional(),
          idempotencyKey
        },
        annotations: this.writeAnnotations('Изменить колонку')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Update);
        this.assertAnyDefined(input, ['title', 'color']);
        return this.toolResult(
          await this.operations.run(
            auth,
            'columns_update',
            input.idempotencyKey,
            input,
            async () => {
              const current = await this.columnsService.getById(
                input.columnId,
                auth.user.id
              );
              this.assertEntityTitle(
                current.title,
                input.columnTitle,
                'колонки'
              );
              const column = await this.columnsService.update(
                input.columnId,
                await validateDto(UpdateColumnDto, {
                  title: input.title,
                  color: input.color
                }),
                auth.user.id
              );
              const board = await this.boardsService.getById(
                column.boardId,
                auth.user.id
              );
              return {
                value: this.toPlain(column),
                projectId: board.projectId
              };
            }
          )
        );
      }
    );

    server.registerTool(
      'columns_reorder',
      {
        description: 'Задать полный порядок колонок доски',
        inputSchema: {
          boardId: z.number().int().positive(),
          boardTitle: title.describe('Точное название доски'),
          columnIds: ids,
          columnTitles: titles,
          idempotencyKey
        },
        annotations: this.writeAnnotations('Изменить порядок колонок')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Update);
        return this.toolResult(
          await this.operations.run(
            auth,
            'columns_reorder',
            input.idempotencyKey,
            input,
            async () => {
              const board = await this.boardsService.getById(
                input.boardId,
                auth.user.id
              );
              this.assertEntityTitle(board.title, input.boardTitle, 'доски');
              const columns = await this.columnsService.getByBoard(
                input.boardId,
                auth.user.id
              );
              this.assertNamedOrder(
                columns,
                input.columnIds,
                input.columnTitles,
                'колонок доски'
              );
              const dto = await validateDto(ReorderColumnsDto, {
                ids: input.columnIds
              });
              await this.columnsService.reorder(
                input.boardId,
                dto,
                auth.user.id
              );
              return {
                value: {
                  reordered: true,
                  boardId: input.boardId,
                  columnIds: input.columnIds
                },
                projectId: board.projectId
              };
            }
          )
        );
      }
    );

    server.registerTool(
      'columns_delete',
      {
        description: 'Мягко удалить колонку с явным подтверждением',
        inputSchema: {
          columnId: z.number().int().positive(),
          columnTitle: title.describe('Точное название колонки'),
          confirm: z.literal(true),
          idempotencyKey
        },
        annotations: this.destructiveAnnotations('Удалить колонку')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Delete);
        return this.toolResult(
          await this.operations.run(
            auth,
            'columns_delete',
            input.idempotencyKey,
            input,
            async () => {
              const column = await this.columnsService.getById(
                input.columnId,
                auth.user.id
              );
              this.assertEntityTitle(
                column.title,
                input.columnTitle,
                'колонки'
              );
              const board = await this.boardsService.getById(
                column.boardId,
                auth.user.id
              );
              await this.columnsService.delete(input.columnId, auth.user.id);
              return {
                value: { deleted: true, columnId: input.columnId },
                projectId: board.projectId
              };
            }
          )
        );
      }
    );

    server.registerTool(
      'tasks_create',
      {
        description: 'Создать верхнеуровневую задачу в колонке',
        inputSchema: {
          columnId: z.number().int().positive(),
          columnTitle: title.describe(
            'Точное название выбранной колонки для подтверждения пользователем'
          ),
          ...taskCreateFields,
          idempotencyKey
        },
        annotations: this.writeAnnotations('Создать задачу')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Update);
        this.assertAnyDefined(input, [
          'title',
          'description',
          'priority',
          'dueDate',
          'assigneeIds',
          'tagIds',
          'approvalStatus',
          'parentTaskId'
        ]);
        return this.toolResult(
          await this.operations.run(
            auth,
            'tasks_create',
            input.idempotencyKey,
            input,
            async () => {
              const projectId = await this.getProjectIdForColumn(
                input.columnId,
                auth.user.id,
                input.columnTitle
              );
              await this.assertTaskReferences(projectId, input);
              const task = await this.tasksService.create(
                input.columnId,
                await validateDto(CreateTaskDto, this.toCreateTaskDto(input)),
                auth.user.id
              );
              return {
                value: this.toPlain(task),
                projectId
              };
            }
          )
        );
      }
    );

    server.registerTool(
      'subtasks_create',
      {
        description: 'Создать подзадачу у существующей задачи',
        inputSchema: {
          parentTaskId: z.number().int().positive(),
          parentTaskTitle: title.describe(
            'Точное название родительской задачи'
          ),
          ...taskCreateFields,
          idempotencyKey
        },
        annotations: this.writeAnnotations('Создать подзадачу')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Update);
        return this.toolResult(
          await this.operations.run(
            auth,
            'subtasks_create',
            input.idempotencyKey,
            input,
            async () => {
              const parent = await this.tasksService.getById(
                input.parentTaskId,
                auth.user.id
              );
              this.assertEntityTitle(
                parent.title,
                input.parentTaskTitle,
                'родительской задачи'
              );
              const projectId = await this.getProjectIdForColumn(
                parent.columnId,
                auth.user.id
              );
              await this.assertTaskReferences(projectId, input);
              const task = await this.tasksService.createSubtask(
                input.parentTaskId,
                await validateDto(CreateTaskDto, this.toCreateTaskDto(input)),
                auth.user.id
              );
              return {
                value: this.toPlain(task),
                projectId
              };
            }
          )
        );
      }
    );

    server.registerTool(
      'tasks_update',
      {
        description:
          'Изменить задачу или подзадачу; parentTaskId=null открепляет подзадачу',
        inputSchema: {
          taskId: z.number().int().positive(),
          taskTitle: title.describe('Текущее точное название задачи'),
          ...taskUpdateFields,
          idempotencyKey
        },
        annotations: this.writeAnnotations('Изменить задачу')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Update);
        this.assertAnyDefined(input, [
          'title',
          'description',
          'priority',
          'dueDate',
          'assigneeIds',
          'tagIds',
          'approvalStatus',
          'parentTaskId'
        ]);
        return this.toolResult(
          await this.operations.run(
            auth,
            'tasks_update',
            input.idempotencyKey,
            input,
            async () => {
              const current = await this.tasksService.getById(
                input.taskId,
                auth.user.id
              );
              this.assertEntityTitle(current.title, input.taskTitle, 'задачи');
              const projectId = await this.getProjectIdForColumn(
                current.columnId,
                auth.user.id
              );
              await this.assertTaskReferences(projectId, input);
              const task = await this.tasksService.update(
                input.taskId,
                await validateDto(UpdateTaskDto, this.toUpdateTaskDto(input)),
                auth.user.id
              );
              return {
                value: this.toPlain(task),
                projectId
              };
            }
          )
        );
      }
    );

    server.registerTool(
      'tasks_move',
      {
        description:
          'Переместить верхнеуровневую задачу вместе с подзадачами в колонку и позицию',
        inputSchema: {
          taskId: z.number().int().positive(),
          taskTitle: title.describe('Точное название задачи'),
          columnId: z.number().int().positive(),
          columnTitle: title.describe('Точное название целевой колонки'),
          order: z.number().int().nonnegative(),
          idempotencyKey
        },
        annotations: this.writeAnnotations('Переместить задачу')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Update);
        return this.toolResult(
          await this.operations.run(
            auth,
            'tasks_move',
            input.idempotencyKey,
            input,
            async () => {
              const current = await this.tasksService.getById(
                input.taskId,
                auth.user.id
              );
              this.assertEntityTitle(current.title, input.taskTitle, 'задачи');
              const projectId = await this.getProjectIdForColumn(
                input.columnId,
                auth.user.id,
                input.columnTitle
              );
              const task = await this.tasksService.move(
                input.taskId,
                await validateDto(MoveTaskDto, {
                  columnId: input.columnId,
                  order: input.order
                }),
                auth.user.id
              );
              return {
                value: this.toPlain(task),
                projectId
              };
            }
          )
        );
      }
    );

    server.registerTool(
      'tasks_delete',
      {
        description: 'Мягко удалить задачу или подзадачу с подтверждением',
        inputSchema: {
          taskId: z.number().int().positive(),
          taskTitle: title.describe('Точное название задачи'),
          confirm: z.literal(true),
          idempotencyKey
        },
        annotations: this.destructiveAnnotations('Удалить задачу')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Delete);
        return this.toolResult(
          await this.operations.run(
            auth,
            'tasks_delete',
            input.idempotencyKey,
            input,
            async () => {
              const task = await this.tasksService.getById(
                input.taskId,
                auth.user.id
              );
              this.assertEntityTitle(task.title, input.taskTitle, 'задачи');
              const projectId = await this.getProjectIdForColumn(
                task.columnId,
                auth.user.id
              );
              await this.tasksService.delete(input.taskId, auth.user.id);
              return {
                value: { deleted: true, taskId: input.taskId },
                projectId
              };
            }
          )
        );
      }
    );

    server.registerTool(
      'task_comments_create',
      {
        description:
          'Оставить комментарий к задаче или ответить в существующем thread',
        inputSchema: {
          taskId: z.number().int().positive(),
          taskTitle: title.describe('Точное название задачи'),
          content: z.string().trim().min(1).max(50000),
          threadId: z.string().trim().min(1).max(128).optional(),
          answerCommentId: z.string().trim().min(1).max(128).optional(),
          idempotencyKey
        },
        annotations: this.writeAnnotations('Оставить комментарий')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Update);
        return this.toolResult(
          await this.operations.run(
            auth,
            'task_comments_create',
            input.idempotencyKey,
            input,
            async () => {
              const task = await this.tasksService.getById(
                input.taskId,
                auth.user.id
              );
              this.assertEntityTitle(task.title, input.taskTitle, 'задачи');
              const projectId = await this.getProjectIdForColumn(
                task.columnId,
                auth.user.id
              );
              const comment = await this.taskComments.create(
                input.taskId,
                {
                  content: input.content,
                  threadId: input.threadId,
                  answerCommentId: input.answerCommentId
                },
                auth
              );
              return { value: comment, projectId };
            }
          )
        );
      }
    );
  }

  private async assertProjectTitle(
    projectId: number,
    userId: number,
    expectedTitle: string
  ): Promise<void> {
    const project = await this.projectsService.getById(projectId, userId);
    this.assertEntityTitle(project.title, expectedTitle, 'проекта');
  }

  private async assertTagTitle(
    projectId: number,
    tagId: number,
    expectedLabel: string
  ): Promise<void> {
    const tags = await this.tagsService.getByProject(projectId);
    const tag = tags.find(item => item.id === tagId);
    this.assertEntityTitle(tag?.label, expectedLabel, 'тега');
  }

  private async assertNamedUsers(
    userIds?: number[],
    userNames?: string[]
  ): Promise<void> {
    if (!userIds && !userNames) return;
    if (!userIds || !userNames || userIds.length !== userNames.length) {
      throw new BadRequestException(
        'Для каждого выбранного пользователя нужно передать его точное имя'
      );
    }

    const users = await this.usersService.getUsersList();
    const usersById = new Map(users.map(user => [user.id, user]));
    userIds.forEach((userId, index) => {
      const user = usersById.get(userId);
      const acceptedNames = [user?.initial, user?.login, user?.serviceNumber]
        .filter(Boolean)
        .map(value => this.normalizeName(String(value)));
      if (!acceptedNames.includes(this.normalizeName(userNames[index]))) {
        throw new BadRequestException(
          'Имя выбранного пользователя не соответствует фактическим данным'
        );
      }
    });
  }

  private async assertTaskReferences(
    projectId: number,
    input: {
      assigneeIds?: number[];
      assigneeNames?: string[];
      tagIds?: number[];
      tagLabels?: string[];
    }
  ): Promise<void> {
    await this.assertNamedUsers(input.assigneeIds, input.assigneeNames);
    if (!input.tagIds && !input.tagLabels) return;
    if (
      !input.tagIds ||
      !input.tagLabels ||
      input.tagIds.length !== input.tagLabels.length
    ) {
      throw new BadRequestException(
        'Для каждого выбранного тега нужно передать его точное название'
      );
    }

    const tags = await this.tagsService.getByProject(projectId);
    const tagsById = new Map(tags.map(tag => [tag.id, tag]));
    input.tagIds.forEach((tagId, index) => {
      this.assertEntityTitle(
        tagsById.get(tagId)?.label,
        input.tagLabels?.[index] || '',
        'тега'
      );
    });
  }

  private assertNamedOrder(
    actualEntities: Array<{ id: number; title: string }>,
    requestedIds: number[],
    requestedTitles: string[],
    label: string
  ): void {
    this.assertCompleteOrder(
      actualEntities.map(entity => entity.id),
      requestedIds,
      label
    );
    if (requestedIds.length !== requestedTitles.length) {
      throw new BadRequestException(
        `Для каждой сущности из порядка ${label} нужно передать название`
      );
    }

    const entitiesById = new Map(
      actualEntities.map(entity => [entity.id, entity])
    );
    requestedIds.forEach((id, index) => {
      this.assertEntityTitle(
        entitiesById.get(id)?.title,
        requestedTitles[index],
        label
      );
    });
  }

  private assertEntityTitle(
    actualTitle: string | undefined,
    expectedTitle: string,
    label: string
  ): void {
    if (
      !actualTitle ||
      this.normalizeName(actualTitle) !== this.normalizeName(expectedTitle)
    ) {
      throw new BadRequestException(
        `Название ${label} не соответствует фактическому названию`
      );
    }
  }

  private normalizeName(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
  }

  private async getProjectIdForColumn(
    columnId: number,
    userId: number,
    expectedColumnTitle?: string
  ): Promise<number> {
    const column = await this.columnsService.getById(columnId, userId);
    if (expectedColumnTitle) {
      this.assertEntityTitle(
        column.title,
        expectedColumnTitle,
        'выбранной колонки'
      );
    }
    const board = await this.boardsService.getById(column.boardId, userId);
    return board.projectId;
  }

  private toCreateTaskDto(input: {
    title: string;
    description?: string;
    priority?: string;
    dueDate?: string;
    assigneeIds?: number[];
    tagIds?: number[];
    approvalStatus?: string;
  }): CreateTaskDto {
    return {
      title: input.title,
      description: input.description,
      priority: input.priority,
      dueDate: input.dueDate,
      assigneeIds: input.assigneeIds,
      tagIds: input.tagIds,
      approvalStatus: input.approvalStatus
    };
  }

  private toUpdateTaskDto(input: {
    title?: string;
    description?: string;
    priority?: string;
    dueDate?: string;
    assigneeIds?: number[];
    tagIds?: number[];
    approvalStatus?: string;
    parentTaskId?: null;
  }): UpdateTaskDto {
    return {
      title: input.title,
      description: input.description,
      priority: input.priority,
      dueDate: input.dueDate,
      assigneeIds: input.assigneeIds,
      tagIds: input.tagIds,
      approvalStatus: input.approvalStatus,
      parentTaskId: input.parentTaskId
    };
  }

  private assertAnyDefined(
    input: Record<string, unknown>,
    fields: string[]
  ): void {
    if (!fields.some(field => input[field] !== undefined)) {
      throw new BadRequestException(
        `Нужно передать хотя бы одно поле: ${fields.join(', ')}`
      );
    }
  }

  private assertCompleteOrder(
    actualIds: number[],
    requestedIds: number[],
    label: string
  ): void {
    const actual = [...actualIds].sort((left, right) => left - right);
    const requested = [...requestedIds].sort((left, right) => left - right);
    if (
      actual.length !== requested.length ||
      actual.some((id, index) => id !== requested[index])
    ) {
      throw new BadRequestException(
        `Порядок должен содержать полный набор ${label}`
      );
    }
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

  private destructiveAnnotations(title: string) {
    return {
      title,
      readOnlyHint: false,
      destructiveHint: true,
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
