import { ApiProperty } from '@nestjs/swagger';
import { Model, Column, DataType, Table } from 'sequelize-typescript';
import { EnumUserRole } from '../enums/role.enum';

@Table({ tableName: 'users' })
export class User extends Model<User> {
  @ApiProperty({ example: 1, description: 'Уникальный идентификатор' })
  @Column({
    type: DataType.INTEGER,
    unique: true,
    autoIncrement: true,
    primaryKey: true
  })
  id: number;

  @ApiProperty({
    example: 'erp-uuid-123',
    description: 'ID пользователя в ERP'
  })
  @Column({
    type: DataType.STRING,
    allowNull: true,
    unique: true,
    field: 'erp_id'
  })
  erpId: string;

  @ApiProperty({ example: 'Петров Виталий Валентинович', description: 'ФИО' })
  @Column({ type: DataType.STRING, allowNull: false })
  initial: string;

  @ApiProperty({ example: '001', description: 'Табельный номер' })
  @Column({
    type: DataType.STRING,
    unique: true,
    allowNull: false,
    field: 'service_number'
  })
  serviceNumber: string;

  @ApiProperty({ example: 'Петров В.В.', description: 'Логин' })
  @Column({ type: DataType.STRING, allowNull: false })
  login: string;

  @ApiProperty({
    example: 'http://photo.png',
    description: 'Аватар пользователя'
  })
  @Column({ type: DataType.STRING, defaultValue: null })
  image: string;

  @ApiProperty({ example: false, description: 'Блокировка пользователя' })
  @Column({ type: DataType.BOOLEAN, defaultValue: false })
  ban: boolean;

  @ApiProperty({
    example: 'admin',
    type: String,
    enum: EnumUserRole,
    description: 'Роль пользователя'
  })
  @Column({ type: DataType.STRING, defaultValue: '-' })
  role: string;
}
