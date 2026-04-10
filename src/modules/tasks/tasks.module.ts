import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { Task } from './model/task.model';
import { TaskAssignee } from './model/task-assignee.model';
import { TaskTag } from './model/task-tag.model';
import { TaskAttachment } from './model/task-attachment.model';
import { Project } from '../projects/model/project.model';
import { BoardColumn } from '../columns/model/board-column.model';

@Module({
  controllers: [TasksController],
  providers: [TasksService],
  imports: [
    SequelizeModule.forFeature([
      Task,
      TaskAssignee,
      TaskTag,
      TaskAttachment,
      Project,
      BoardColumn
    ])
  ],
  exports: [TasksService]
})
export class TasksModule {}
