import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';
import { Board } from './model/board.model';

@Module({
  controllers: [BoardsController],
  providers: [BoardsService],
  imports: [SequelizeModule.forFeature([Board])],
  exports: [BoardsService]
})
export class BoardsModule {}
