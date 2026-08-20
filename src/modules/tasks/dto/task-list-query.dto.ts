import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min
} from 'class-validator';

export class TaskListQueryDto {
  @ApiPropertyOptional({
    example: 5,
    minimum: 1,
    maximum: 100,
    description: 'Количество корневых задач в порции'
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    example: 0,
    minimum: 0,
    description: 'Смещение от начала упорядоченного списка'
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;

  @ApiPropertyOptional({
    example: 'согласовать макет',
    maxLength: 200,
    description: 'Поиск по номеру, названию и описанию задачи'
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
