import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { BoardColumn } from './model/board-column.model';
import { CreateColumnDto } from './dto/create-column.dto';
import { UpdateColumnDto } from './dto/update-column.dto';
import { ReorderColumnsDto } from './dto/reorder-columns.dto';
import { WsGateway } from '../ws/ws.gateway';
import { Board } from '../boards/model/board.model';
import { ProjectAccessService } from '../projects/project-access.service';

@Injectable()
export class ColumnsService {
  private readonly logger = new Logger(ColumnsService.name);

  constructor(
    @InjectModel(BoardColumn) private columnRepository: typeof BoardColumn,
    @InjectModel(Board) private boardRepository: typeof Board,
    private sequelize: Sequelize,
    private wsGateway: WsGateway,
    private projectAccess: ProjectAccessService
  ) {}

  private async assertBoardAccess(boardId: number, userId: number) {
    const board = await this.boardRepository.findByPk(boardId);
    if (!board) {
      throw new HttpException('Доска не найдена', HttpStatus.NOT_FOUND);
    }
    await this.projectAccess.assertCanRead(board.projectId, userId);
    return board;
  }

  private async getAccessibleColumn(id: number, userId: number) {
    const column = await this.columnRepository.findByPk(id);
    if (!column) {
      throw new HttpException('Колонка не найдена', HttpStatus.NOT_FOUND);
    }
    await this.assertBoardAccess(column.boardId, userId);
    return column;
  }

  async getByBoard(boardId: number, userId: number): Promise<BoardColumn[]> {
    try {
      await this.assertBoardAccess(boardId, userId);
      return await this.columnRepository.findAll({
        where: { boardId },
        order: [['order', 'ASC']]
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('getByBoard failed', error);
      throw new HttpException(
        'Ошибка при получении колонок',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async create(
    boardId: number,
    dto: CreateColumnDto,
    userId: number
  ): Promise<BoardColumn> {
    const transaction = await this.sequelize.transaction();
    try {
      await this.assertBoardAccess(boardId, userId);
      // Определяем следующий order атомарно внутри транзакции
      const maxOrder = await this.columnRepository.max<number, BoardColumn>(
        'order',
        {
          where: { boardId },
          transaction
        }
      );

      const column = await this.columnRepository.create(
        {
          boardId,
          title: dto.title,
          color: dto.color || null,
          order: (maxOrder || 0) + 1
        } as any,
        { transaction }
      );

      await transaction.commit();

      // WS
      this.wsGateway.emitColumnCreated(boardId, column);

      return column;
    } catch (error) {
      await transaction.rollback();
      if (error instanceof HttpException) throw error;
      this.logger.error('create column failed', error);
      throw new HttpException(
        'Ошибка при создании колонки',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async update(
    id: number,
    dto: UpdateColumnDto,
    userId: number
  ): Promise<BoardColumn> {
    try {
      const column = await this.getAccessibleColumn(id, userId);
      if (dto.title !== undefined) column.title = dto.title;
      if (dto.color !== undefined) column.color = dto.color;
      await column.save();

      // WS
      this.wsGateway.emitColumnUpdated(column.boardId, column);

      return column;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('update column failed', error);
      throw new HttpException(
        'Ошибка при обновлении колонки',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async delete(id: number, userId: number): Promise<void> {
    try {
      const column = await this.getAccessibleColumn(id, userId);
      const boardId = column.boardId;
      await column.destroy();

      // WS
      this.wsGateway.emitColumnDeleted(boardId, id);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('delete column failed', error);
      throw new HttpException(
        'Ошибка при удалении колонки',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async reorder(
    boardId: number,
    dto: ReorderColumnsDto,
    userId: number
  ): Promise<void> {
    const transaction = await this.sequelize.transaction();
    try {
      await this.assertBoardAccess(boardId, userId);
      for (let i = 0; i < dto.ids.length; i++) {
        await this.columnRepository.update(
          { order: i },
          { where: { id: dto.ids[i], boardId }, transaction }
        );
      }
      await transaction.commit();

      // WS
      this.wsGateway.emitColumnReordered(boardId, dto.ids);
    } catch (error) {
      await transaction.rollback();
      if (error instanceof HttpException) throw error;
      this.logger.error('reorder columns failed', error);
      throw new HttpException(
        'Ошибка при сортировке колонок',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
