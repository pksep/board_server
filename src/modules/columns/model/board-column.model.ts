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
import { ColumnStatus } from '../interfaces/column-status.interface';
import { ColumnMovePermission } from '../interfaces/column-move-permission.interface';

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

  @ApiProperty({
    enum: ColumnStatus,
    nullable: true,
    description: 'Статус задач колонки; по умолчанию не выбран'
  })
  @Col({
    type: DataType.STRING(32),
    allowNull: true,
    defaultValue: null,
    validate: { isIn: [Object.values(ColumnStatus)] }
  })
  status: ColumnStatus | null;

  @ApiProperty({
    enum: ColumnMovePermission,
    default: ColumnMovePermission.AnyActions,
    description:
      'Разрешение на вывод задач из колонки; владельцем считается создатель задачи'
  })
  @Col({
    type: DataType.STRING(32),
    allowNull: false,
    defaultValue: ColumnMovePermission.AnyActions,
    field: 'move_permission',
    validate: { isIn: [Object.values(ColumnMovePermission)] }
  })
  movePermission: ColumnMovePermission;

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
