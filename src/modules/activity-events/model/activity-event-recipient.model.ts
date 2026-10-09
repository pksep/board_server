import {
  Column,
  BelongsTo,
  DataType,
  ForeignKey,
  Model,
  Table
} from 'sequelize-typescript';
import { User } from '../../users/model/users.model';
import { ActivityEvent } from './activity-event.model';

/** Получатель канонического события и его персональная отметка прочтения. */
@Table({
  tableName: 'activity_event_recipients',
  timestamps: false,
  indexes: [
    { name: 'activity_recipients_feed_idx', fields: ['user_id', 'event_id'] },
    {
      name: 'activity_recipients_unread_idx',
      fields: ['user_id', 'event_id'],
      where: { read_at: null }
    }
  ]
})
export class ActivityEventRecipient extends Model<ActivityEventRecipient> {
  @ForeignKey(() => ActivityEvent)
  @Column({
    type: DataType.INTEGER,
    field: 'event_id',
    primaryKey: true,
    allowNull: false,
    onDelete: 'CASCADE'
  })
  eventId: number;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    field: 'user_id',
    primaryKey: true,
    allowNull: false,
    onDelete: 'CASCADE'
  })
  userId: number;

  @Column({ type: DataType.DATE, field: 'read_at', allowNull: true })
  readAt: Date | null;

  @BelongsTo(() => ActivityEvent, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  event: ActivityEvent;

  @BelongsTo(() => User, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  user: User;
}
