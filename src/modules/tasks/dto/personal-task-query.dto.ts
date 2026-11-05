import { ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsOptional
} from 'class-validator';
import {
  ColumnStatus,
  normalizeLegacyColumnStatus
} from '../../columns/interfaces/column-status.interface';
import { TaskListQueryDto } from './task-list-query.dto';

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

  @ApiPropertyOptional({ enum: ['dueDate', 'startDate'], default: 'dueDate' })
  @IsOptional()
  @IsIn(['dueDate', 'startDate'])
  sortBy?: 'dueDate' | 'startDate';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection?: 'asc' | 'desc';
}
