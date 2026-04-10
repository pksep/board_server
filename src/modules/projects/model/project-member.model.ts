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

// Lazy require для решения circular dependency (SWC live bindings)
const lazyProject = () => require('./project.model').Project;

@Table({ tableName: 'project_members' })
export class ProjectMember extends Model<ProjectMember> {
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

  @ApiProperty({ example: 1, description: 'ID пользователя' })
  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'user_id' })
  userId: number;

  @ApiHideProperty()
  @BelongsTo(lazyProject)
  project: any;

  @ApiHideProperty()
  @BelongsTo(() => User)
  user: User;
}
