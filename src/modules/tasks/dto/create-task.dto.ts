import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDateString,
  IsArray,
  ArrayUnique,
  IsInt,
  IsEnum,
  MaxLength,
  ArrayMaxSize,
  Min,
  ValidateNested
} from 'class-validator';
import { IsObject } from 'class-validator';
import { Type } from 'class-transformer';
import { TaskEntityDto } from './task-entity.dto';
import { TTaskAttributeValues } from 'src/modules/projects/interfaces/task-attribute.interface';

export class CreateTaskDto {
  @ApiProperty({
    description: 'Сущность из базы продукции',
    type: TaskEntityDto,
    nullable: true,
    required: false
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => TaskEntityDto)
  linkedEntity?: TaskEntityDto | null;

  @ApiProperty({ example: 'Исправить баг', description: 'Название задачи' })
  @IsString()
  @IsNotEmpty({ message: 'Название задачи обязательно' })
  @MaxLength(255, {
    message: 'Название задачи не должно превышать 255 символов'
  })
  title: string;

  @ApiProperty({ description: 'Описание (HTML)' })
  @IsOptional()
  @IsString()
  @MaxLength(200000)
  description?: string;

  @ApiProperty({ enum: ['', 'low', 'medium', 'high', 'urgent'] })
  @IsOptional()
  @IsEnum(['', 'low', 'medium', 'high', 'urgent'])
  priority?: string;

  @ApiProperty({ description: 'Требуемое время готовности' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiProperty({ description: 'Дата начала работ' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({ example: [1, 2], description: 'ID исполнителей' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  assigneeIds?: number[];

  @ApiProperty({ example: [1, 3], description: 'ID тегов проекта' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  tagIds?: number[];

  @ApiProperty({ enum: ['', 'yes', 'no'], description: 'Статус утверждения' })
  @IsOptional()
  @IsEnum(['', 'yes', 'no'])
  approvalStatus?: string;

  @ApiProperty({ description: 'Значения пользовательских атрибутов задачи' })
  @IsOptional()
  @IsObject()
  customAttributeValues?: TTaskAttributeValues;
}
