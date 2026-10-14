import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min
} from 'class-validator';
import { TaskEntityType } from '../interfaces/task-entity.interface';
import type { TaskEntityReference } from '../interfaces/task-entity.interface';

export class TaskEntityDto implements TaskEntityReference {
  @ApiProperty({ enum: TaskEntityType })
  @IsEnum(TaskEntityType)
  type: TaskEntityType;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  id: number;

  @ApiProperty({ description: 'Название выбранной продукции' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  name: string;

  @ApiProperty({ description: 'Обозначение выбранной продукции' })
  @IsString()
  @MaxLength(512)
  designation: string;
}
