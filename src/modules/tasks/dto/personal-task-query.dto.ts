import { ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min
} from 'class-validator';
import {
  ColumnStatus,
  normalizeLegacyColumnStatus
} from '../../columns/interfaces/column-status.interface';
import { parseNumberQueryList, TaskListQueryDto } from './task-list-query.dto';

/** Личные списки используют те же ограничения размера страницы, что список колонки. */
export class PersonalTaskQueryDto extends PickType(TaskListQueryDto, [
  'limit',
  'offset'
] as const) {
  @ApiPropertyOptional({ enum: ['created', 'assigned'], default: 'created' })
  @IsOptional()
  @IsIn(['created', 'assigned'])
  scope?: 'created' | 'assigned' = 'created';

  @ApiPropertyOptional({ enum: ColumnStatus })
  @IsOptional()
  @Transform(({ value }) => normalizeLegacyColumnStatus(value))
  @IsEnum(ColumnStatus)
  columnStatus?: ColumnStatus;

  @ApiPropertyOptional({ enum: ColumnStatus, isArray: true })
  @IsOptional()
  @Transform(({ value }): unknown[] => [
    ...new Set(
      (Array.isArray(value) ? value : [value]).map(normalizeLegacyColumnStatus)
    )
  ])
  @IsArray()
  @ArrayMaxSize(Object.values(ColumnStatus).length)
  @IsEnum(ColumnStatus, { each: true })
  columnStatuses?: ColumnStatus[];

  @ApiPropertyOptional({ description: 'Идентификатор колонки личных задач' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  columnId?: number;

  @ApiPropertyOptional({
    example: '12,35',
    description:
      'Колонки личных задач через запятую. Достаточно совпадения с одной.'
  })
  @IsOptional()
  @Transform(({ value }): number[] => [...new Set(parseNumberQueryList(value))])
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(2147483647, { each: true })
  columnIds?: number[];

  @ApiPropertyOptional({
    maxLength: 200,
    description: 'Подстрока названия личной задачи'
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  includeColumnOptions?: 'true' | 'false';

  @ApiPropertyOptional({ enum: ['dueDate', 'startDate'], default: 'dueDate' })
  @IsOptional()
  @IsIn(['dueDate', 'startDate'])
  sortBy?: 'dueDate' | 'startDate';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}
