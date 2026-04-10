import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Board } from './model/board.model';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';
import { BoardColumn } from '../columns/model/board-column.model';
import { WsGateway } from '../ws/ws.gateway';

@Injectable()
export class BoardsService {
  private readonly logger = new Logger(BoardsService.name);

  constructor(
    @InjectModel(Board) private boardRepository: typeof Board,
    private wsGateway: WsGateway
  ) {}

  async getByProject(projectId: number): Promise<Board[]> {
    try {
      return await this.boardRepository.findAll({
        where: { projectId },
        include: [{ model: BoardColumn, attributes: ['id'] }],
        order: [
          ['order', 'ASC'],
          ['createdAt', 'ASC']
        ]
      });
    } catch (error) {
      this.logger.error('getByProject failed', error);
      throw new HttpException(
        'Ошибка при получении досок',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async getById(id: number): Promise<Board> {
    try {
      const board = await this.boardRepository.findByPk(id, {
        include: [
          {
            model: BoardColumn,
            order: [['order', 'ASC']]
          }
        ]
      });
      if (!board) {
        throw new HttpException('Доска не найдена', HttpStatus.NOT_FOUND);
      }
      return board;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('getById failed', error);
      throw new HttpException(
        'Ошибка при получении доски',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async create(projectId: number, dto: CreateBoardDto): Promise<Board> {
    try {
      const maxOrder = await this.boardRepository.max<number, Board>('order', {
        where: { projectId }
      });

      const board = await this.boardRepository.create({
        projectId,
        title: dto.title,
        startDate: dto.startDate || null,
        endDate: dto.endDate || null,
        order: (maxOrder || 0) + 1
      } as any);
      return board;
    } catch (error) {
      this.logger.error('create board failed', error);
      throw new HttpException(
        'Ошибка при создании доски',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async update(id: number, dto: UpdateBoardDto): Promise<Board> {
    try {
      const board = await this.boardRepository.findByPk(id);
      if (!board) {
        throw new HttpException('Доска не найдена', HttpStatus.NOT_FOUND);
      }
      if (dto.title !== undefined) board.title = dto.title;
      if (dto.startDate !== undefined) board.startDate = dto.startDate as any;
      if (dto.endDate !== undefined) board.endDate = dto.endDate as any;
      await board.save();
      return board;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('update board failed', error);
      throw new HttpException(
        'Ошибка при обновлении доски',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async reorder(projectId: number, ids: number[]): Promise<void> {
    try {
      const promises = ids.map((id, idx) =>
        this.boardRepository.update({ order: idx } as any, {
          where: { id, projectId }
        })
      );
      await Promise.all(promises);

      // WS: уведомляем о порядке досок
      this.wsGateway.emitBoardReordered(projectId, ids);
    } catch (error) {
      this.logger.error('reorder boards failed', error);
      throw new HttpException(
        'Ошибка при сортировке досок',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async delete(id: number): Promise<void> {
    try {
      const board = await this.boardRepository.findByPk(id);
      if (!board) {
        throw new HttpException('Доска не найдена', HttpStatus.NOT_FOUND);
      }
      await board.destroy();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('delete board failed', error);
      throw new HttpException(
        'Ошибка при удалении доски',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
