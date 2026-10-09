import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class ReadTaskActivityDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  taskId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  throughEventId: number;
}
