import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
  Model,
  Column as Col,
  DataType,
  Table,
  ForeignKey,
  BelongsTo,
  HasMany
} from 'sequelize-typescript';

// Lazy requires для решения circular dependency (BoardColumn ↔ Board, BoardColumn → Task)
const lazyBoard = () => require('../../boards/model/board.model').Board;
const lazyTask = () => require('../../tasks/model/task.model').Task;

@Table({ tableName: 'board_columns', paranoid: true })
export class BoardColumn extends Model<BoardColumn> {
  @ApiProperty({ example: 1, description: 'Уникальный идентификатор' })
  @Col({
    type: DataType.INTEGER,
    autoIncrement: true,
    primaryKey: true
  })
  id: number;

  @ApiProperty({ example: 1, description: 'ID доски' })
  @ForeignKey(lazyBoard)
  @Col({ type: DataType.INTEGER, allowNull: false, field: 'board_id' })
  boardId: number;

  @ApiProperty({ example: 'В работе', description: 'Название колонки' })
  @Col({ type: DataType.STRING, allowNull: false })
  title: string;

  @ApiProperty({ example: '#548CF6', description: 'CSS-цвет' })
  @Col({ type: DataType.STRING, allowNull: true, defaultValue: null })
  color: string;

  @ApiProperty({ example: 0, description: 'Порядок' })
  @Col({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  order: number;

  @ApiHideProperty()
  @BelongsTo(lazyBoard)
  board: any;

  @ApiHideProperty()
  @HasMany(lazyTask)
  tasks: any[];
}
