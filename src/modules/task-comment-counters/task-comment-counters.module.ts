import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TasksModule } from '../tasks/tasks.module';
import { TaskCommentCountersController } from './task-comment-counters.controller';
import { TaskCommentCountersService } from './task-comment-counters.service';

@Module({
  imports: [TasksModule, ConfigModule],
  controllers: [TaskCommentCountersController],
  providers: [TaskCommentCountersService]
})
export class TaskCommentCountersModule {}
