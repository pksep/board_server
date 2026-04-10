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

// Lazy requires для решения circular dependency (SWC live bindings)
const lazyProject = () => require('../../projects/model/project.model').Project;
const lazyTaskTag = () => require('../../tasks/model/task-tag.model').TaskTag;

@Table({ tableName: 'project_tags', paranoid: true })
export class ProjectTag extends Model<ProjectTag> {
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

  @ApiProperty({ example: 'Баг', description: 'Название тега' })
  @Column({ type: DataType.STRING, allowNull: false })
  label: string;

  @ApiProperty({
    example: 'var(--tag-pink, #FE3A8B)',
    description: 'CSS-цвет тега'
  })
  @Column({ type: DataType.STRING, allowNull: false })
  color: string;

  @ApiProperty({ example: 'Описание тега', description: 'Описание' })
  @Column({ type: DataType.STRING, allowNull: true })
  description: string;

  @ApiHideProperty()
  @BelongsTo(lazyProject)
  project: any;

  @ApiHideProperty()
  @HasMany(lazyTaskTag)
  taskTags: any[];
}
