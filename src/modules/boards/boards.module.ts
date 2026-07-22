import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';
import { Board } from './model/board.model';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  controllers: [BoardsController],
  providers: [BoardsService],
  imports: [SequelizeModule.forFeature([Board]), ProjectsModule],
  exports: [BoardsService]
})
export class BoardsModule {}
