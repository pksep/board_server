import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
  Model,
  Column,
  DataType,
  Table,
  ForeignKey,
  BelongsTo
} from 'sequelize-typescript';
import { User } from 'src/modules/users/model/users.model';
import type { Project } from './project.model';
import type { UserFavoriteCreationAttributes } from '../interfaces/project-creation-attributes.interface';

// Lazy require для решения circular dependency (SWC live bindings)
const lazyProject = () => require('./project.model').Project;

@Table({
  tableName: 'user_favorites',
  indexes: [{ unique: true, fields: ['user_id', 'project_id'] }]
})
export class UserFavorite extends Model<
  UserFavorite,
  UserFavoriteCreationAttributes
> {
  @ApiProperty({ example: 1, description: 'Уникальный идентификатор' })
  @Column({
    type: DataType.INTEGER,
    autoIncrement: true,
    primaryKey: true
  })
  id: number;

  @ApiProperty({ example: 1, description: 'ID пользователя' })
  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'user_id' })
  userId: number;

  @ApiProperty({ example: 1, description: 'ID проекта' })
  @ForeignKey(lazyProject)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'project_id' })
  projectId: number;

  @ApiHideProperty()
  @BelongsTo(() => User)
  user: User;

  @ApiHideProperty()
  @BelongsTo(lazyProject)
  project: Project;
}
