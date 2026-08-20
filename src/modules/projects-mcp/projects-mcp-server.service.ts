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
import { UpdateBoardDto } from '../boards/dto/update-board.dto';
import { ColumnsService } from '../columns/columns.service';
import { CreateColumnDto } from '../columns/dto/create-column.dto';
import { ReorderColumnsDto } from '../columns/dto/reorder-columns.dto';
import { UpdateColumnDto } from '../columns/dto/update-column.dto';
import { CreateProjectDto } from '../projects/dto/create-project.dto';
import { UpdateProjectDto } from '../projects/dto/update-project.dto';
import { ProjectAccessService } from '../projects/project-access.service';
import { ProjectsService } from '../projects/projects.service';
import { TagsService } from '../tags/tags.service';
import { CreateTaskDto } from '../tasks/dto/create-task.dto';
import { MoveTaskDto } from '../tasks/dto/move-task.dto';
import { UpdateTaskDto } from '../tasks/dto/update-task.dto';
import { TasksService } from '../tasks/tasks.service';
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
        this.assertAnyDefined(input, ['title', 'startDate', 'endDate']);
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
    const taskCreateFields = {
      title,
      description: z.string().max(200000).optional(),
      priority: z.enum(['', 'low', 'medium', 'high', 'urgent']).optional(),
      dueDate: date.optional(),
      assigneeIds: z.array(z.number().int().positive()).max(500).optional(),
      tagIds: z.array(z.number().int().positive()).max(500).optional(),
      approvalStatus: z.enum(['', 'yes', 'no']).optional()
    };
    const taskUpdateFields = {
      title: title.optional(),
      description: z.string().max(200000).optional(),
      priority: z.enum(['', 'low', 'medium', 'high', 'urgent']).optional(),
      dueDate: date.optional(),
      assigneeIds: z.array(z.number().int().positive()).max(500).optional(),
      tagIds: z.array(z.number().int().positive()).max(500).optional(),
      approvalStatus: z.enum(['', 'yes', 'no']).optional(),
      parentTaskId: z.null().optional()
    };

    server.registerTool(
      'boards_create',
      {
        description: 'Создать доску в проекте',
        inputSchema: {
          projectId: z.number().int().positive(),
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
              const board = await this.boardsService.create(
                input.projectId,
                {
                  title: input.title,
                  startDate: input.startDate,
                  endDate: input.endDate
                } as CreateBoardDto,
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
          title: title.optional(),
          startDate: date.optional(),
          endDate: date.optional(),
          idempotencyKey
        },
        annotations: this.writeAnnotations('Изменить доску')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Update);
        return this.toolResult(
          await this.operations.run(
            auth,
            'boards_update',
            input.idempotencyKey,
            input,
            async () => {
              const board = await this.boardsService.update(
                input.boardId,
                {
                  title: input.title,
                  startDate: input.startDate,
                  endDate: input.endDate
                } as UpdateBoardDto,
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
          boardIds: ids,
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
              const boards = await this.boardsService.getByProject(
                input.projectId,
                auth.user.id
              );
              this.assertCompleteOrder(
                boards.map(board => board.id),
                input.boardIds,
                'досок проекта'
              );
              await this.boardsService.reorder(
                input.projectId,
                input.boardIds,
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
              const column = await this.columnsService.create(
                input.boardId,
                {
                  title: input.title,
                  color: input.color
                } as CreateColumnDto,
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
          title: title.optional(),
          color: z.string().trim().max(64).optional(),
          idempotencyKey
        },
        annotations: this.writeAnnotations('Изменить колонку')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Update);
        return this.toolResult(
          await this.operations.run(
            auth,
            'columns_update',
            input.idempotencyKey,
            input,
            async () => {
              const column = await this.columnsService.update(
                input.columnId,
                {
                  title: input.title,
                  color: input.color
                } as UpdateColumnDto,
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
          columnIds: ids,
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
              const columns = await this.columnsService.getByBoard(
                input.boardId,
                auth.user.id
              );
              this.assertCompleteOrder(
                columns.map(column => column.id),
                input.columnIds,
                'колонок доски'
              );
              await this.columnsService.reorder(
                input.boardId,
                { ids: input.columnIds } as ReorderColumnsDto,
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
              const task = await this.tasksService.create(
                input.columnId,
                this.toCreateTaskDto(input),
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
          ...taskCreateFields,
          idempotencyKey
        },
        annotations: this.writeAnnotations('Создать подзадачу')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Update);
        if (input.answerCommentId && !input.threadId) {
          throw new BadRequestException(
            'answerCommentId требует существующий threadId'
          );
        }
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
              const projectId = await this.getProjectIdForColumn(
                parent.columnId,
                auth.user.id
              );
              const task = await this.tasksService.createSubtask(
                input.parentTaskId,
                this.toCreateTaskDto(input),
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
          ...taskUpdateFields,
          idempotencyKey
        },
        annotations: this.writeAnnotations('Изменить задачу')
      },
      async input => {
        this.assertScope(auth, ProjectsMcpScope.Update);
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
              const projectId = await this.getProjectIdForColumn(
                current.columnId,
                auth.user.id
              );
              const task = await this.tasksService.update(
                input.taskId,
                this.toUpdateTaskDto(input),
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
          columnId: z.number().int().positive(),
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
              const projectId = await this.getProjectIdForColumn(
                input.columnId,
                auth.user.id
              );
              const task = await this.tasksService.move(
                input.taskId,
                {
                  columnId: input.columnId,
                  order: input.order
                } as MoveTaskDto,
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

  private async getProjectIdForColumn(
    columnId: number,
    userId: number,
    expectedColumnTitle?: string
  ): Promise<number> {
    const column = await this.columnsService.getById(columnId, userId);
    if (
      expectedColumnTitle &&
      column.title.trim().toLocaleLowerCase('ru-RU') !==
        expectedColumnTitle.trim().toLocaleLowerCase('ru-RU')
    ) {
      throw new BadRequestException(
        'Название выбранной колонки не соответствует её фактическому названию'
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
