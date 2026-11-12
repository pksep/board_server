import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Put,
  UseGuards
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { CreateAttachmentDto } from './dto/create-attachment.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { IUserDataToken } from '../auth/interfaces/interface';
import { ActivityHistoryQueryDto } from '../activity-events/dto/activity-history-query.dto';
import { TaskListQueryDto } from './dto/task-list-query.dto';
import { CreateTaskTimeEntryDto } from './dto/create-task-time-entry.dto';
import type { TaskTimeEntry, TaskTimeEntryPage } from './tasks.service';
import type { Task } from './model/task.model';
import { TaskGanttQueryDto } from './dto/task-gantt-query.dto';
import type { TaskGanttSnapshot } from './interfaces/task-gantt.interface';
import { PersonalTaskQueryDto } from './dto/personal-task-query.dto';
import type { PersonalTaskPage } from './interfaces/personal-task.interface';
import { ExecutorTaskQueryDto } from './dto/executor-task-query.dto';
import { ExecutorWorkloadQueryDto } from './dto/executor-workload-query.dto';
import type { ExecutorWorkloadTask } from './interfaces/executor-workload.interface';
import { TaskTimeReportQueryDto } from './dto/task-time-report-query.dto';
import type { TaskTimeReportPage } from './interfaces/task-time-report.interface';
import { TimeReportPermissionGuard } from './time-report-permission.guard';
import { ExecutorPlanningPermissionGuard } from './executor-planning-permission.guard';
import { TaskCommentCountersService } from '../task-comment-counters/task-comment-counters.service';
import type { TaskListPage } from './tasks.service';
import type { CounterRequestSession } from '../task-comment-counters/interfaces/task-comment-counter.interface';

@ApiTags('Задачи')
@Controller()
export class TasksController {
  constructor(
    private tasksService: TasksService,
    private readonly commentCounters: TaskCommentCountersService
  ) {}

  /** Читает время только тех проектов, которые доступны текущему пользователю. */
  @ApiOperation({ summary: 'Фактическое время задач за период' })
  @Get('tasks/time-report')
  @UseGuards(TimeReportPermissionGuard)
  getTimeReport(
    @Query() query: TaskTimeReportQueryDto,
    @CurrentUser() user: IUserDataToken
  ): Promise<TaskTimeReportPage> {
    return this.tasksService.getTimeReport(user.id, query);
  }

  /** Показывает назначения в планировании; доступ к карточке возвращается отдельно. */
  @ApiOperation({
    summary: 'Задачи исполнителя ERP с досок, в которых он участвует'
  })
  @Get('tasks/by-executor')
  @UseGuards(ExecutorPlanningPermissionGuard)
  async getExecutorTasks(
    @Query() query: ExecutorTaskQueryDto,
    @CurrentUser() user: IUserDataToken,
    @Req() request: CounterRequestSession
  ): Promise<PersonalTaskPage> {
    // Пользователь сессии определяет доступ, ERP ID — только целевого исполнителя.
    const page = await this.tasksService.getPersonalTasks(
      user.id,
      { scope: 'assigned', limit: query.limit, offset: query.offset },
      String(query.erpUserId)
    );
    await this.commentCounters.attachToTasks(
      page.items.map(item => item.task),
      request
    );

    return page;
  }

  /** Планирование учитывает все действующие назначения после проверки права ERP. */
  @ApiOperation({
    summary: 'Нормы задач исполнителей ERP за календарный период'
  })
  @Get('tasks/executor-workload')
  @UseGuards(ExecutorPlanningPermissionGuard)
  getExecutorWorkload(
    @Query() query: ExecutorWorkloadQueryDto,
    @CurrentUser() user: IUserDataToken
  ): Promise<ExecutorWorkloadTask[]> {
    // ERP ID выбирают ресурсы, но не подменяют текущего пользователя.
    return this.tasksService.getExecutorWorkload(user.id, query);
  }

  /** Пользователь берётся из сессии, а не из произвольного ID в фильтре. */
  @ApiOperation({ summary: 'Созданные мной или назначенные мне задачи' })
  @Get('tasks/personal')
  async getPersonalTasks(
    @Query() query: PersonalTaskQueryDto,
    @CurrentUser() user: IUserDataToken,
    @Req() request: CounterRequestSession
  ): Promise<PersonalTaskPage> {
    const page = await this.tasksService.getPersonalTasks(user.id, query);
    await this.commentCounters.attachToTasks(
      page.items.map(item => item.task),
      request
    );

    return page;
  }

  /** Использует каноническое чтение задач с проверкой доступа к проекту. */
  @ApiOperation({ summary: 'Список задач и сроки для диаграммы Ганта проекта' })
  @Get('projects/:projectId/gantt')
  getProjectGantt(
    @Param('projectId') projectId: number,
    @Query() query: TaskGanttQueryDto,
    @CurrentUser() user: IUserDataToken
  ): Promise<TaskGanttSnapshot> {
    return this.tasksService.getProjectGantt(+projectId, user.id, query);
  }

  @ApiOperation({ summary: 'Все задачи доски' })
  @Get('boards/:boardId/tasks')
  async getByBoard(
    @Param('boardId') boardId: number,
    @CurrentUser() user: IUserDataToken,
    @Req() request: CounterRequestSession
  ): Promise<Task[]> {
    const tasks = await this.tasksService.getByBoard(+boardId, user.id);
    await this.commentCounters.attachToTasks(tasks, request);

    return tasks;
  }

  @ApiOperation({ summary: 'Получить задачу по ID' })
  @Get('tasks/:id')
  async getById(
    @Param('id') id: number,
    @CurrentUser() user: IUserDataToken,
    @Req() request: CounterRequestSession
  ): Promise<Task> {
    const task = await this.tasksService.getById(+id, user.id);
    await this.commentCounters.attachToTasks([task], request);

    return task;
  }

  @ApiOperation({ summary: 'Получить историю изменений задачи' })
  @Get('tasks/:id/history')
  getHistory(
    @Param('id') id: number,
    @Query() query: ActivityHistoryQueryDto,
    @CurrentUser() user: IUserDataToken
  ) {
    return this.tasksService.getHistory(+id, user.id, query);
  }

  @ApiOperation({ summary: 'Получить записи времени задачи' })
  @Get('tasks/:id/time-entries')
  getTimeEntries(
    @Param('id') id: number,
    @Query() query: ActivityHistoryQueryDto,
    @CurrentUser() user: IUserDataToken
  ): Promise<TaskTimeEntryPage> {
    return this.tasksService.getTimeEntries(+id, user.id, query);
  }

  @ApiOperation({ summary: 'Добавить фактическое время выполнения задачи' })
  @Post('tasks/:id/time-entries')
  createTimeEntry(
    @Param('id') id: number,
    @Body() dto: CreateTaskTimeEntryDto,
    @CurrentUser() user: IUserDataToken
  ): Promise<TaskTimeEntry> {
    return this.tasksService.createTimeEntry(+id, dto, user.id);
  }

  @ApiOperation({ summary: 'Все задачи колонки' })
  @Get('columns/:columnId/tasks')
  async getByColumn(
    @Param('columnId') columnId: number,
    @Query() query: TaskListQueryDto,
    @CurrentUser() user: IUserDataToken,
    @Req() request: CounterRequestSession
  ): Promise<Task[] | TaskListPage> {
    const page = await this.tasksService.getByColumn(+columnId, user.id, query);
    await this.commentCounters.attachToTasks(
      Array.isArray(page) ? page : page.items,
      request
    );

    return page;
  }

  @ApiOperation({ summary: 'Создать задачу в колонке' })
  @Post('columns/:columnId/tasks')
  create(
    @Param('columnId') columnId: number,
    @Body() dto: CreateTaskDto,
    @CurrentUser() user: IUserDataToken
  ) {
    return this.tasksService.create(+columnId, dto, user.id);
  }

  @ApiOperation({ summary: 'Создать подзадачу' })
  @Post('tasks/:parentId/subtasks')
  createSubtask(
    @Param('parentId') parentId: number,
    @Body() dto: CreateTaskDto,
    @CurrentUser() user: IUserDataToken
  ) {
    return this.tasksService.createSubtask(+parentId, dto, user.id);
  }

  @ApiOperation({ summary: 'Получить подзадачи' })
  @Get('tasks/:id/subtasks')
  async getSubtasks(
    @Param('id') id: number,
    @CurrentUser() user: IUserDataToken,
    @Req() request: CounterRequestSession
  ): Promise<Task[]> {
    const tasks = await this.tasksService.getSubtasks(+id, user.id);
    await this.commentCounters.attachToTasks(tasks, request);

    return tasks;
  }

  @ApiOperation({ summary: 'Обновить задачу' })
  @Put('tasks/:id')
  update(
    @Param('id') id: number,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: IUserDataToken
  ) {
    return this.tasksService.update(+id, dto, user.id);
  }

  @ApiOperation({ summary: 'Переместить задачу' })
  @Patch('tasks/:id/move')
  move(
    @Param('id') id: number,
    @Body() dto: MoveTaskDto,
    @CurrentUser() user: IUserDataToken
  ) {
    return this.tasksService.move(+id, dto, user.id);
  }

  @ApiOperation({ summary: 'Удалить задачу (soft delete)' })
  @Delete('tasks/:id')
  delete(@Param('id') id: number, @CurrentUser() user: IUserDataToken) {
    return this.tasksService.delete(+id, user.id);
  }

  /** Возвращает запись через канонический сервис задач с сохранением прав проекта. */
  @ApiOperation({ summary: 'Вернуть задачу из архива' })
  @Post('tasks/:id/restore')
  restore(
    @Param('id') id: number,
    @CurrentUser() user: IUserDataToken
  ): Promise<Task> {
    return this.tasksService.restore(+id, user.id);
  }

  @ApiOperation({ summary: 'Получить URL для прямой загрузки файла в MinIO' })
  @Post('tasks/:id/attachments/presign')
  generatePresignedUrl(
    @Param('id') id: number,
    @Body() dto: CreateAttachmentDto,
    @CurrentUser() user: IUserDataToken,
    @Req() request: Request
  ) {
    return this.tasksService.generatePresignedUrl(+id, dto, user.id, request);
  }

  @ApiOperation({ summary: 'Подтвердить загрузку вложения' })
  @Post('tasks/:id/attachments/confirm')
  confirmAttachment(
    @Param('id') id: number,
    @Body() dto: CreateAttachmentDto,
    @CurrentUser() user: IUserDataToken
  ) {
    return this.tasksService.confirmAttachment(+id, dto, user.id);
  }

  @ApiOperation({ summary: 'Удалить вложение' })
  @Delete('tasks/:taskId/attachments/:attachmentId')
  deleteAttachment(
    @Param('taskId') taskId: number,
    @Param('attachmentId') attachmentId: number,
    @CurrentUser() user: IUserDataToken
  ) {
    return this.tasksService.deleteAttachment(+taskId, +attachmentId, user.id);
  }
}
