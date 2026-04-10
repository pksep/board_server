import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDateString,
  IsArray,
  IsEnum
} from 'class-validator';

export class CreateTaskDto {
  @ApiProperty({ example: 'Исправить баг', description: 'Название задачи' })
  @IsString()
  @IsNotEmpty({ message: 'Название задачи обязательно' })
  title: string;

  @ApiProperty({ description: 'Описание (HTML)' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: ['', 'low', 'medium', 'high', 'urgent'] })
  @IsOptional()
  @IsEnum(['', 'low', 'medium', 'high', 'urgent'])
  priority?: string;

  @ApiProperty({ description: 'Дедлайн' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiProperty({ example: [1, 2], description: 'ID исполнителей' })
  @IsOptional()
  @IsArray()
  assigneeIds?: number[];

  @ApiProperty({ example: [1, 3], description: 'ID тегов проекта' })
  @IsOptional()
  @IsArray()
  tagIds?: number[];

  @ApiProperty({ enum: ['', 'yes', 'no'], description: 'Статус утверждения' })
  @IsOptional()
  @IsEnum(['', 'yes', 'no'])
  approvalStatus?: string;
}
