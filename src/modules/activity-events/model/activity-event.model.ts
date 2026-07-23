import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table
} from 'sequelize-typescript';
import { Project } from 'src/modules/projects/model/project.model';
import { User } from 'src/modules/users/model/users.model';
import {
  ActivityActionType,
  ActivityEntityType
} from '../activity-events.constants';
import { ActivityChange } from '../interfaces/activity-event.interface';

@Table({
  tableName: 'activity_events',
  updatedAt: false,
  indexes: [
    {
      name: 'activity_events_entity_history_idx',
      fields: ['project_id', 'entity_type', 'entity_id', 'id']
    },
    {
      name: 'activity_events_project_history_idx',
      fields: ['project_id', 'id']
    }
  ]
})
export class ActivityEvent extends Model<ActivityEvent> {
  @ApiProperty({ example: 1, description: 'Уникальный идентификатор события' })
  @Column({
    type: DataType.INTEGER,
    autoIncrement: true,
    primaryKey: true
  })
  id: number;

  @ApiProperty({ example: 1, description: 'ID проекта в момент события' })
  @ForeignKey(() => Project)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    field: 'project_id'
  })
  projectId: number;

  @ApiProperty({ enum: ActivityEntityType, example: ActivityEntityType.Task })
  @Column({
    type: DataType.STRING(32),
    allowNull: false,
    field: 'entity_type'
  })
  entityType: ActivityEntityType;

  @ApiProperty({ example: '42', description: 'ID изменённой сущности' })
  @Column({
    type: DataType.STRING(64),
    allowNull: false,
    field: 'entity_id'
  })
  entityId: string;

  @ApiProperty({
    enum: ActivityActionType,
    example: ActivityActionType.Updated
  })
  @Column({
    type: DataType.STRING(32),
    allowNull: false,
    field: 'action_type'
  })
  actionType: ActivityActionType;

  @ApiProperty({
    example: 7,
    nullable: true,
    description: 'ID пользователя, выполнившего действие'
  })
  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    field: 'actor_user_id'
  })
  actorUserId: number | null;

  @ApiProperty({
    example: [{ field: 'title', before: 'До', after: 'После' }]
  })
  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: []
  })
  changes: ActivityChange[];

  @ApiProperty({ example: { taskNumber: 12 } })
  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: {}
  })
  metadata: Record<string, unknown>;

  @ApiHideProperty()
  @BelongsTo(() => Project)
  project: Project;

  @ApiProperty({
    description: 'Автор действия',
    type: () => User,
    nullable: true
  })
  @BelongsTo(() => User, {
    foreignKey: 'actorUserId',
    as: 'actor'
  })
  actor: User | null;
}
