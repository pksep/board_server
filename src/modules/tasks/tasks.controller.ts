import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Put
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { CreateAttachmentDto } from './dto/create-attachment.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { IUserDataToken } from '../auth/interfaces/interface';
import { ActivityHistoryQueryDto } from '../activity-events/dto/activity-history-query.dto';

@ApiTags('Задачи')
@Controller()
export class TasksController {
  constructor(private tasksService: TasksService) {}

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

  @ApiOperation({ summary: 'Все задачи колонки' })
  @Get('columns/:columnId/tasks')
  getByColumn(
    @Param('columnId') columnId: number,
    @CurrentUser() user: IUserDataToken
  ) {
    return this.tasksService.getByColumn(+columnId, user.id);
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

  @ApiOperation({ summary: 'Получить URL для прямой загрузки файла в MinIO' })
  @Post('tasks/:id/attachments/presign')
  generatePresignedUrl(
    @Param('id') id: number,
    @Body() dto: CreateAttachmentDto,
    @CurrentUser() user: IUserDataToken
  ) {
    return this.tasksService.generatePresignedUrl(+id, dto, user.id);
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
