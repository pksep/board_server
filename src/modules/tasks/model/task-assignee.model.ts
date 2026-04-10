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
const lazyTask = () => require('./task.model').Task;

@Table({ tableName: 'task_assignees' })
export class TaskAssignee extends Model<TaskAssignee> {
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

  @ApiProperty({ example: 1, description: 'ID пользователя' })
  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'user_id' })
  userId: number;

  @ApiHideProperty()
  @BelongsTo(lazyTask)
  task: any;

  @ApiHideProperty()
  @BelongsTo(() => User)
  user: User;
}
