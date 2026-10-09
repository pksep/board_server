import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { IUserDataToken } from '../auth/interfaces/interface';
import { ActivityHistoryQueryDto } from './dto/activity-history-query.dto';
import { ReadTaskActivityDto } from './dto/read-task-activity.dto';
import { ActivityEventPage } from './interfaces/activity-event.interface';
import {
  TaskActivityCounts,
  TaskActivityItem
} from './interfaces/task-activity.interface';
import { TaskActivityService } from './task-activity.service';

@Controller('activity/task-feed')
export class TaskActivityController {
  constructor(private activity: TaskActivityService) {}

  /** Лента исполнителя: идентификатор получателя берётся только из серверной сессии. */
  @Get()
  getFeed(
    @CurrentUser() user: IUserDataToken,
    @Query() query: ActivityHistoryQueryDto
  ): Promise<ActivityEventPage<TaskActivityItem>> {
    return this.activity.getFeed(user.id, query);
  }

  /** Персональные счётчики навигации и карточек проектов. */
  @Get('counts')
  getCounts(@CurrentUser() user: IUserDataToken): Promise<TaskActivityCounts> {
    return this.activity.getCounts(user.id);
  }

  /** Прочтение не меняет задачу и не удаляет её историю. */
  @Patch('read')
  markRead(
    @CurrentUser() user: IUserDataToken,
    @Body() dto: ReadTaskActivityDto
  ): Promise<void> {
    return this.activity.markRead(user.id, dto);
  }
}
