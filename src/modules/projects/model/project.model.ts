import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
  Model,
  Column,
  DataType,
  Table,
  HasMany,
  ForeignKey,
  BelongsTo
} from 'sequelize-typescript';
import { User } from 'src/modules/users/model/users.model';

// Lazy requires для решения circular dependency (SWC live bindings)
// Project ↔ ProjectMember, Project ↔ Board, Project ↔ ProjectTag, Project ↔ UserFavorite
const lazyProjectMember = () => require('./project-member.model').ProjectMember;
const lazyBoard = () => require('../../boards/model/board.model').Board;
const lazyProjectTag = () =>
  require('../../tags/model/project-tag.model').ProjectTag;
const lazyUserFavorite = () => require('./user-favorite.model').UserFavorite;

@Table({ tableName: 'projects', paranoid: true })
export class Project extends Model<Project> {
  @ApiProperty({ example: 1, description: 'Уникальный идентификатор' })
  @Column({
    type: DataType.INTEGER,
    autoIncrement: true,
    primaryKey: true
  })
  id: number;

  @ApiProperty({ example: 'Мой проект', description: 'Название проекта' })
  @Column({ type: DataType.STRING, allowNull: false })
  title: string;

  @ApiProperty({
    example: 'PRJ',
    description: 'Уникальный префикс проекта (мин. 3 англ. буквы)'
  })
  @Column({
    type: DataType.STRING(10),
    allowNull: false,
    unique: true,
    validate: {
      len: [3, 10],
      is: /^[A-Za-z]+$/i
    }
  })
  prefix: string;

  @ApiProperty({ example: 'Описание проекта', description: 'Описание' })
  @Column({ type: DataType.TEXT, allowNull: true })
  description: string;

  @ApiProperty({
    example: 0,
    description: 'Счётчик задач для генерации taskNumber'
  })
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'task_counter'
  })
  taskCounter: number;

  @ApiProperty({ example: 1, description: 'ID создателя' })
  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'created_by_id' })
  createdById: number;

  @ApiHideProperty()
  @BelongsTo(() => User)
  createdBy: User;

  @ApiHideProperty()
  @HasMany(lazyProjectMember)
  members: any[];

  @ApiHideProperty()
  @HasMany(lazyProjectTag)
  tags: any[];

  @ApiHideProperty()
  @HasMany(lazyBoard)
  boards: any[];

  @ApiHideProperty()
  @HasMany(lazyUserFavorite)
  favorites: any[];
}
