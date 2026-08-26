import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min
} from 'class-validator';

const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

/** Преобразует одиночный или повторяющийся query-параметр в список значений. */
function parseQueryList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];

  return values
    .flatMap(item => String(item ?? '').split(','))
    .map(item => item.trim())
    .filter(Boolean);
}

/** Преобразует строковые идентификаторы из URL в числа для Sequelize-запроса. */
function parseNumberQueryList(value: unknown): number[] {
  return parseQueryList(value).map(item => Number(item));
}

/** Преобразует только явные строковые boolean-значения, сохраняя ошибки валидации. */
function parseQueryBoolean(value: unknown): unknown {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
}

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

  @ApiPropertyOptional({
    example: '7,15',
    description: 'Идентификаторы исполнителей; внутри группы применяется OR'
  })
  @IsOptional()
  @Transform(({ value }) => parseNumberQueryList(value))
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  @Min(1, { each: true })
  assigneeIds?: number[];

  @ApiPropertyOptional({
    example: 'high,urgent',
    description: 'Приоритеты; внутри группы применяется OR'
  })
  @IsOptional()
  @Transform(({ value }) => parseQueryList(value))
  @IsArray()
  @ArrayMaxSize(TASK_PRIORITIES.length)
  @IsIn(TASK_PRIORITIES, { each: true })
  priorities?: string[];

  @ApiPropertyOptional({
    example: '3,9',
    description: 'Идентификаторы тегов; внутри группы применяется OR'
  })
  @IsOptional()
  @Transform(({ value }) => parseNumberQueryList(value))
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  @Min(1, { each: true })
  tagIds?: number[];

  @ApiPropertyOptional({
    example: true,
    description: 'Учитывать совпавшие подзадачи при выборе корневых карточек'
  })
  @IsOptional()
  @Transform(({ value }) => parseQueryBoolean(value))
  @IsBoolean()
  includeSubtasks?: boolean;
}
