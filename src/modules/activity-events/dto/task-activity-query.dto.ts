import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ActivityHistoryQueryDto } from './activity-history-query.dto';

/** Режим и курсор новых действий расширяют существующую пагинацию истории. */
export class TaskActivityQueryDto extends ActivityHistoryQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'all'], default: 'mine' })
  @IsOptional()
  @IsIn(['mine', 'all'])
  scope?: 'mine' | 'all' = 'mine';

  @ApiPropertyOptional({ description: 'Получить новые события после этого ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  afterId?: number;
}
