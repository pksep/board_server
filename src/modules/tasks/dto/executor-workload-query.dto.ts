import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsISO8601,
  Min
} from 'class-validator';
import { parseNumberQueryList } from './task-list-query.dto';

/** Пакет ресурсов ERP и полуоткрытый период видимых календарных дней. */
export class ExecutorWorkloadQueryDto {
  @ApiProperty({
    example: '18,11,39',
    description: 'До 250 идентификаторов исполнителей ERP через запятую'
  })
  @Transform(({ value }) => parseNumberQueryList(value))
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(250)
  @IsInt({ each: true })
  @Min(1, { each: true })
  erpUserIds: number[];

  @ApiProperty({ description: 'Начало периода включительно, ISO 8601' })
  @IsISO8601({ strict: true })
  start: string;

  @ApiProperty({ description: 'Конец периода не включается, ISO 8601' })
  @IsISO8601({ strict: true })
  end: string;
}
