import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsInt,
  Min
} from 'class-validator';

/** Пакетное чтение загрузки ERP без запроса полного графа задач для каждого сотрудника. */
export class ExecutorWorkloadQueryDto {
  @ApiProperty({
    description: 'ERP ID исполнителей через запятую',
    example: '39,71'
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').map(Number) : value
  )
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  erpUserIds: number[];

  @ApiProperty({
    description: 'Начало периода включительно, ISO с часовым поясом'
  })
  @IsDateString({ strict: true })
  start: string;

  @ApiProperty({
    description: 'Конец периода исключительно, ISO с часовым поясом'
  })
  @IsDateString({ strict: true })
  end: string;
}
