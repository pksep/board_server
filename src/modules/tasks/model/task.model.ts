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
import { User } from 'src/modules/users/model/users.model';

// Lazy requires для решения circular dependency (SWC live bindings)
const lazyBoardColumn = () =>
  require('../../columns/model/board-column.model').BoardColumn;
const lazyTaskAssignee = () => require('./task-assignee.model').TaskAssignee;
const lazyTaskTag = () => require('./task-tag.model').TaskTag;
const lazyTaskAttachment = () =>
  require('./task-attachment.model').TaskAttachment;

@Table({ tableName: 'tasks', paranoid: true })
export class Task extends Model<Task> {
  @ApiProperty({ example: 1, description: 'Уникальный идентификатор' })
  @Column({
    type: DataType.INTEGER,
    autoIncrement: true,
    primaryKey: true
  })
  id: number;

  @ApiProperty({ example: 1, description: 'Номер задачи в рамках проекта' })
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'task_number' })
  taskNumber: number;

  @ApiProperty({ example: 'Исправить баг', description: 'Название задачи' })
  @Column({ type: DataType.STRING, allowNull: false })
  title: string;

  @ApiProperty({ description: 'Описание задачи (HTML)' })
  @Column({ type: DataType.TEXT, allowNull: true, defaultValue: '' })
  description: string;

  @ApiProperty({
    example: 'medium',
    description: 'Приоритет',
    enum: ['', 'low', 'medium', 'high', 'urgent']
  })
  @Column({
    type: DataType.ENUM('', 'low', 'medium', 'high', 'urgent'),
    allowNull: false,
    defaultValue: ''
  })
  priority: string;

  @ApiProperty({
    example: '',
    description: 'Статус согласования',
    enum: ['', 'yes', 'no']
  })
  @Column({
    type: DataType.ENUM('', 'yes', 'no'),
    allowNull: false,
    defaultValue: '',
    field: 'approval_status'
  })
  approvalStatus: string;

  @ApiProperty({ description: 'Дедлайн' })
  @Column({ type: DataType.DATE, allowNull: true, field: 'due_date' })
  dueDate: Date;

  @ApiProperty({ example: 1, description: 'ID колонки' })
  @ForeignKey(lazyBoardColumn)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'column_id' })
  columnId: number;

  @ApiProperty({ example: null, description: 'ID родительской задачи' })
  @ForeignKey(() => Task)
  @Column({ type: DataType.INTEGER, allowNull: true, field: 'parent_task_id' })
  parentTaskId: number;

  @ApiProperty({ example: 0, description: 'Порядок в колонке' })
  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  order: number;

  @ApiProperty({ example: 1, description: 'ID создателя' })
  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'created_by_id' })
  createdById: number;

  // === Связи ===

  @ApiHideProperty()
  @BelongsTo(lazyBoardColumn)
  column: any;

  @ApiHideProperty()
  @BelongsTo(() => User)
  createdBy: User;

  @ApiHideProperty()
  @BelongsTo(() => Task, 'parentTaskId')
  parent: Task;

  @ApiHideProperty()
  @HasMany(() => Task, 'parentTaskId')
  subtasks: Task[];

  @ApiHideProperty()
  @HasMany(lazyTaskAssignee)
  assignees: any[];

  @ApiHideProperty()
  @HasMany(lazyTaskTag)
  tags: any[];

  @ApiHideProperty()
  @HasMany(lazyTaskAttachment)
  attachments: any[];
}
