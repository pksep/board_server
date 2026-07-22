import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ColumnsController } from './columns.controller';
import { ColumnsService } from './columns.service';
import { BoardColumn } from './model/board-column.model';
import { Board } from '../boards/model/board.model';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  controllers: [ColumnsController],
  providers: [ColumnsService],
  imports: [SequelizeModule.forFeature([BoardColumn, Board]), ProjectsModule],
  exports: [ColumnsService]
})
export class ColumnsModule {}
