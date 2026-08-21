import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Board } from './model/board.model';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';
import { WsGateway } from '../ws/ws.gateway';
import { ProjectAccessService } from '../projects/project-access.service';
import { BoardColumn } from '../columns/model/board-column.model';
import { Task } from '../tasks/model/task.model';
import { BoardListQueryDto } from './dto/board-list-query.dto';

type BoardWithTasksCount = Board & { tasksCount: number };

interface BoardListPage {
  items: BoardWithTasksCount[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

@Injectable()
export class BoardsService {
  private readonly logger = new Logger(BoardsService.name);

  constructor(
    @InjectModel(Board) private boardRepository: typeof Board,
    @InjectModel(BoardColumn)
    private columnRepository: typeof BoardColumn,
    @InjectModel(Task) private taskRepository: typeof Task,
    private wsGateway: WsGateway,
    private projectAccess: ProjectAccessService
  ) {}

  async getByProject(
    projectId: number,
    userId: number
  ): Promise<BoardWithTasksCount[]>;
  async getByProject(
    projectId: number,
    userId: number,
    query: BoardListQueryDto
  ): Promise<BoardWithTasksCount[] | BoardListPage>;
  async getByProject(
    projectId: number,
    userId: number,
    query: BoardListQueryDto = {}
  ): Promise<BoardWithTasksCount[] | BoardListPage> {
    try {
      await this.projectAccess.assertCanRead(projectId, userId);
      const isPaginated = query.limit !== undefined;
      const limit = query.limit ?? 0;
      const offset = query.offset ?? 0;
      const total = isPaginated
        ? await this.boardRepository.count({ where: { projectId } })
        : 0;
      const boards = await this.boardRepository.findAll({
        where: { projectId },
        include: [{ association: 'columns', attributes: ['id'] }],
        order: [
          ['order', 'ASC'],
          ['createdAt', 'ASC']
        ],
        ...(isPaginated ? { limit, offset } : {})
      });

      if (!boards.length) {
        return isPaginated
          ? { items: [], total, limit, offset, hasMore: false }
          : [];
      }

      const boardIds = boards.map(board => board.id);
      const columns = await this.columnRepository.findAll({
        where: { boardId: { [Op.in]: boardIds } },
        attributes: ['id', 'boardId'],
        raw: true
      });
      const columnIds = columns.map(column => column.id);
      const tasksCountByColumnId = new Map<number, number>();

      if (columnIds.length) {
        const taskCounts = await this.taskRepository.findAll({
          attributes: [
            'columnId',
            [
              this.taskRepository.sequelize.fn(
                'COUNT',
                this.taskRepository.sequelize.col('id')
              ),
              'tasksCount'
            ]
          ],
          where: {
            columnId: { [Op.in]: columnIds },
            parentTaskId: null
          },
          group: ['columnId'],
          raw: true
        });

        taskCounts.forEach((item: Task & { tasksCount: number | string }) => {
          tasksCountByColumnId.set(item.columnId, Number(item.tasksCount) || 0);
        });
      }

      const columnIdsByBoardId = new Map<number, number[]>();
      columns.forEach(column => {
        const boardColumnIds = columnIdsByBoardId.get(column.boardId) || [];
        boardColumnIds.push(column.id);
        columnIdsByBoardId.set(column.boardId, boardColumnIds);
      });

      const items = boards.map(board => {
        const boardColumnIds = columnIdsByBoardId.get(board.id) || [];
        const tasksCount = boardColumnIds.reduce(
          (total, columnId) =>
            total + (tasksCountByColumnId.get(columnId) || 0),
          0
        );

        return {
          ...board.toJSON(),
          tasksCount
        } as BoardWithTasksCount;
      });

      return isPaginated
        ? {
            items,
            total,
            limit,
            offset,
            hasMore: offset + items.length < total
          }
        : items;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('getByProject failed', error);
      throw new HttpException(
        'Ошибка при получении досок',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async getById(id: number, userId: number): Promise<Board> {
    try {
      const plainBoard = await this.boardRepository.findByPk(id);
      if (!plainBoard) {
        throw new HttpException('Доска не найдена', HttpStatus.NOT_FOUND);
      }
      await this.projectAccess.assertCanRead(plainBoard.projectId, userId);

      const board = await this.boardRepository.findByPk(id, {
        include: [
          {
            association: 'columns',
            separate: true,
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

  async create(
    projectId: number,
    dto: CreateBoardDto,
    userId: number
  ): Promise<Board> {
    try {
      await this.projectAccess.assertCanRead(projectId, userId);
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
      if (error instanceof HttpException) throw error;
      this.logger.error('create board failed', error);
      throw new HttpException(
        'Ошибка при создании доски',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async update(
    id: number,
    dto: UpdateBoardDto,
    userId: number
  ): Promise<Board> {
    try {
      const board = await this.boardRepository.findByPk(id);
      if (!board) {
        throw new HttpException('Доска не найдена', HttpStatus.NOT_FOUND);
      }
      await this.projectAccess.assertCanRead(board.projectId, userId);
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

  async reorder(
    projectId: number,
    ids: number[],
    userId: number
  ): Promise<void> {
    try {
      await this.projectAccess.assertCanRead(projectId, userId);
      const promises = ids.map((id, idx) =>
        this.boardRepository.update({ order: idx } as any, {
          where: { id, projectId }
        })
      );
      await Promise.all(promises);

      // WS: уведомляем о порядке досок
      this.wsGateway.emitBoardReordered(projectId, ids);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('reorder boards failed', error);
      throw new HttpException(
        'Ошибка при сортировке досок',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async delete(id: number, userId: number): Promise<void> {
    try {
      const board = await this.boardRepository.findByPk(id);
      if (!board) {
        throw new HttpException('Доска не найдена', HttpStatus.NOT_FOUND);
      }
      await this.projectAccess.assertCanRead(board.projectId, userId);
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
