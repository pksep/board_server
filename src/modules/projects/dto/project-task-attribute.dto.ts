import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength
} from 'class-validator';
import { TaskAttributeType } from '../interfaces/task-attribute.interface';

export class ProjectTaskAttributeDto {
  @ApiProperty({ example: 'attribute-123', description: 'Стабильный ID поля' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  id: string;

  @ApiProperty({ example: 'Стоимость', description: 'Название поля' })
  @IsString()
  @IsNotEmpty({ message: 'Название атрибута обязательно' })
  @MaxLength(100)
  name: string;

  @ApiProperty({ enum: TaskAttributeType, description: 'Тип значения поля' })
  @IsEnum(TaskAttributeType)
  type: TaskAttributeType;
}
