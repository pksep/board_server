import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
  Model,
  Column,
  DataType,
  Table,
  ForeignKey,
  BelongsTo,
  HasMany
} from 'sequelize-typescript';

// Lazy require для решения circular dependency (Board ↔ Project)
const lazyProject = () => require('../../projects/model/project.model').Project;
const lazyBoardColumn = () =>
  require('../../columns/model/board-column.model').BoardColumn;

@Table({ tableName: 'boards', paranoid: true })
export class Board extends Model<Board> {
  @ApiProperty({ example: 1, description: 'Уникальный идентификатор' })
  @Column({
    type: DataType.INTEGER,
    autoIncrement: true,
    primaryKey: true
  })
  id: number;

  @ApiProperty({ example: 1, description: 'ID проекта' })
  @ForeignKey(lazyProject)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'project_id' })
  projectId: number;

  @ApiProperty({ example: 'Спринт 1', description: 'Название доски' })
  @Column({ type: DataType.STRING, allowNull: false })
  title: string;

  @ApiProperty({ description: 'Дата начала' })
  @Column({ type: DataType.DATE, allowNull: true, field: 'start_date' })
  startDate: Date;

  @ApiProperty({ description: 'Дата окончания' })
  @Column({ type: DataType.DATE, allowNull: true, field: 'end_date' })
  endDate: Date;

  @ApiProperty({ example: 0, description: 'Порядок отображения' })
  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  order: number;

  @ApiHideProperty()
  @BelongsTo(lazyProject)
  project: any;

  @ApiHideProperty()
  @HasMany(lazyBoardColumn)
  columns: any[];
}
