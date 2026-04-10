import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
  Model,
  Column,
  DataType,
  Table,
  ForeignKey,
  BelongsTo
} from 'sequelize-typescript';

// Lazy requires для решения circular dependency (SWC live bindings)
const lazyTask = () => require('./task.model').Task;
const lazyProjectTag = () =>
  require('../../tags/model/project-tag.model').ProjectTag;

@Table({ tableName: 'task_tags' })
export class TaskTag extends Model<TaskTag> {
  @ApiProperty({ example: 1, description: 'Уникальный идентификатор' })
  @Column({
    type: DataType.INTEGER,
    autoIncrement: true,
    primaryKey: true
  })
  id: number;

  @ApiProperty({ example: 1, description: 'ID задачи' })
  @ForeignKey(lazyTask)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'task_id' })
  taskId: number;

  @ApiProperty({ example: 1, description: 'ID тега проекта' })
  @ForeignKey(lazyProjectTag)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'project_tag_id' })
  projectTagId: number;

  @ApiHideProperty()
  @BelongsTo(lazyTask)
  task: any;

  @ApiHideProperty()
  @BelongsTo(lazyProjectTag)
  projectTag: any;
}
