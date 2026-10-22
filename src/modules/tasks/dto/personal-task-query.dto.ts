import { ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { ColumnStatus } from '../../columns/interfaces/column-status.interface';
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
  @IsEnum(ColumnStatus)
  columnStatus?: ColumnStatus;
}
