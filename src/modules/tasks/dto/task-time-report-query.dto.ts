import { Type } from 'class-transformer';
import { IsISO8601, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Полуоткрытый период отчёта: начало включительно, конец не включается. */
export class TaskTimeReportQueryDto {
  @IsISO8601({ strict: true })
  start: string;

  @IsISO8601({ strict: true })
  end: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beforeId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
