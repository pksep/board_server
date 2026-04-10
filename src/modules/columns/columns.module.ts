import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ColumnsController } from './columns.controller';
import { ColumnsService } from './columns.service';
import { BoardColumn } from './model/board-column.model';

@Module({
  controllers: [ColumnsController],
  providers: [ColumnsService],
  imports: [SequelizeModule.forFeature([BoardColumn])],
  exports: [ColumnsService]
})
export class ColumnsModule {}
