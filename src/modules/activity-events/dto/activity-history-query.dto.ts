import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ActivityHistoryQueryDto {
  @ApiPropertyOptional({
    example: 50,
    minimum: 1,
    maximum: 100,
    default: 50
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @ApiPropertyOptional({
    example: 120,
    description: 'ID последней записи предыдущей страницы'
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beforeId?: number;
}
