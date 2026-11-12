import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  Min
} from 'class-validator';
import { parseNumberQueryList } from './task-list-query.dto';

/** Необязательный пакет ресурсов ERP и полуоткрытый период календаря. */
export class ExecutorWorkloadQueryDto {
  @ApiPropertyOptional({
    example: '18,11,39',
    description:
      'До 250 идентификаторов исполнителей ERP через запятую; без фильтра — все доступные назначения'
  })
  @IsOptional()
  @Transform(({ value }) => parseNumberQueryList(value))
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(250)
  @IsInt({ each: true })
  @Min(1, { each: true })
  erpUserIds?: number[];

  @ApiProperty({ description: 'Начало периода включительно, ISO 8601' })
  @IsISO8601({ strict: true })
  start: string;

  @ApiProperty({ description: 'Конец периода не включается, ISO 8601' })
  @IsISO8601({ strict: true })
  end: string;

  @ApiPropertyOptional({
    description:
      'Включить задолженность с началом работ до этой границы, ISO 8601'
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  debtBefore?: string;
}
