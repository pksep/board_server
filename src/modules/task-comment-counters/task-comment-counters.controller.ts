import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import type { IUserDataToken } from '../auth/interfaces/interface';
import { PersonalTaskQueryDto } from '../tasks/dto/personal-task-query.dto';
import { TaskCommentCountersService } from './task-comment-counters.service';
import type { TaskCommentCounters } from './interfaces/task-comment-counter.interface';

@ApiTags('Комментарии задач')
@Controller('tasks')
export class TaskCommentCountersController {
  constructor(private readonly counters: TaskCommentCountersService) {}

  @ApiOperation({ summary: 'Комментарии всего личного списка задач' })
  @Get('personal/comment-counters')
  personal(
    @CurrentUser() user: IUserDataToken,
    @Query() query: PersonalTaskQueryDto,
    @Req() request: Request
  ): Promise<TaskCommentCounters> {
    return this.counters.personal(user.id, query, request);
  }

  @ApiOperation({
    summary: 'Отметить комментарии открытой задачи прочитанными'
  })
  @Post(':id/comments/read')
  markTaskRead(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: IUserDataToken,
    @Req() request: Request
  ): Promise<TaskCommentCounters> {
    return this.counters.markTaskRead(id, user.id, request);
  }
}
