import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';
import { Board } from './model/board.model';
import { ProjectsModule } from '../projects/projects.module';
import { BoardColumn } from '../columns/model/board-column.model';
import { Task } from '../tasks/model/task.model';

@Module({
  controllers: [BoardsController],
  providers: [BoardsService],
  imports: [
    SequelizeModule.forFeature([Board, BoardColumn, Task]),
    ProjectsModule
  ],
  exports: [BoardsService]
})
export class BoardsModule {}
