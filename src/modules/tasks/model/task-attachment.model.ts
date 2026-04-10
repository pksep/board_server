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

@Table({ tableName: 'task_attachments' })
export class TaskAttachment extends Model<TaskAttachment> {
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

  @ApiProperty({
    example: 'document.pdf',
    description: 'Оригинальное имя файла'
  })
  @Column({ type: DataType.STRING, allowNull: false, field: 'file_name' })
  fileName: string;

  @ApiProperty({
    example: 'tasks/1/abc123.pdf',
    description: 'Ключ объекта в MinIO'
  })
  @Column({ type: DataType.STRING, allowNull: false, field: 'object_name' })
  objectName: string;

  @ApiProperty({ example: 'application/pdf', description: 'MIME-тип' })
  @Column({ type: DataType.STRING, allowNull: false, field: 'mime_type' })
  mimeType: string;

  @ApiProperty({ example: 102400, description: 'Размер в байтах' })
  @Column({ type: DataType.INTEGER, allowNull: false })
  size: number;

  @ApiProperty({ example: 1, description: 'ID загрузившего' })
  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'uploaded_by_id' })
  uploadedById: number;

  @ApiHideProperty()
  @BelongsTo(lazyTask)
  task: any;

  @ApiHideProperty()
  @BelongsTo(() => User)
  uploadedBy: User;
}
