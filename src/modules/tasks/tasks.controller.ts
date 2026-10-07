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
  Put
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

@ApiTags('Задачи')
@Controller()
export class TasksController {
  constructor(private tasksService: TasksService) {}

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
  getByBoard(
    @Param('boardId') boardId: number,
    @CurrentUser() user: IUserDataToken
  ) {
    return this.tasksService.getByBoard(+boardId, user.id);
  }

  @ApiOperation({ summary: 'Получить задачу по ID' })
  @Get('tasks/:id')
  getById(@Param('id') id: number, @CurrentUser() user: IUserDataToken) {
    return this.tasksService.getById(+id, user.id);
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
  getByColumn(
    @Param('columnId') columnId: number,
    @Query() query: TaskListQueryDto,
    @CurrentUser() user: IUserDataToken
  ) {
    return this.tasksService.getByColumn(+columnId, user.id, query);
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
  getSubtasks(@Param('id') id: number, @CurrentUser() user: IUserDataToken) {
    return this.tasksService.getSubtasks(+id, user.id);
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
