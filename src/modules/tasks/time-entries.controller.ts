import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TasksService, TaskTimeEntry } from './tasks.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { IUserDataToken } from '../auth/interfaces/interface';
import { CreateTaskTimeEntryDto } from './dto/create-task-time-entry.dto';
import { TaskTimeReportQueryDto } from './dto/task-time-report-query.dto';
import { StandaloneTimePermissionGuard } from './standalone-time-permission.guard';
import type { StandaloneTimeReportPage } from './interfaces/task-time-report.interface';

@ApiTags('Учёт времени')
@Controller('time-entries')
@UseGuards(StandaloneTimePermissionGuard)
export class TimeEntriesController {
  constructor(private readonly tasksService: TasksService) {}

  /** Читает самостоятельное время без доступа к проектам. */
  @Get()
  getReport(
    @Query() query: TaskTimeReportQueryDto
  ): Promise<StandaloneTimeReportPage> {
    return this.tasksService.getStandaloneTimeReport(query);
  }

  /** Общая операция записи определяет автора по подтверждённой сессии. */
  @Post()
  create(
    @Body() dto: CreateTaskTimeEntryDto,
    @CurrentUser() user: IUserDataToken
  ): Promise<TaskTimeEntry> {
    return this.tasksService.createTimeEntry(null, dto, user.id);
  }
}
