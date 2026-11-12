import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsISO8601,
  Min
} from 'class-validator';
import { parseNumberQueryList } from './task-list-query.dto';

/** Пакет ресурсов ERP и полуоткрытый период видимых календарных дней. */
export class ExecutorWorkloadQueryDto {
  @ApiProperty({
    description:
      'ERP ID исполнителей через запятую; без фильтра — все назначения за период',
    example: '39,71',
    required: false
  })
  @Transform(({ value }) => parseNumberQueryList(value))
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(250)
  @IsInt({ each: true })
  @Min(1, { each: true })
  erpUserIds?: number[];

  @ApiProperty({ description: 'Начало периода включительно, ISO 8601' })
  @IsISO8601({ strict: true })
  start: string;

  @ApiProperty({
    description:
      'Начало всего выбранного периода: более ранние назначения включаются как задолженность',
    required: false
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  debtBefore?: string;

  @ApiProperty({
    description: 'Конец периода исключительно, ISO с часовым поясом'
  })
  @IsISO8601({ strict: true })
  end: string;
}
