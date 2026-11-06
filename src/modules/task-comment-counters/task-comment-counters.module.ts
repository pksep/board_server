import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TasksModule } from '../tasks/tasks.module';
import { TaskCommentCountersController } from './task-comment-counters.controller';

@Module({
  imports: [TasksModule, ConfigModule],
  controllers: [TaskCommentCountersController]
})
export class TaskCommentCountersModule {}
