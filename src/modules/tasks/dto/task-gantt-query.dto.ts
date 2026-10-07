import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { parseNumberQueryList } from './task-list-query.dto';

/** Использует общий контракт отбора исполнителей; счётчик не загружает карточки. */
export class TaskGanttQueryDto {
  // До серверного отбора Гант не ограничивал число выбранных исполнителей.
  @ApiPropertyOptional({
    description: 'Исполнители; подходит любой выбранный участник'
  })
  @IsOptional()
  @Transform(({ value }) => parseNumberQueryList(value))
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  assigneeIds?: number[];

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'Вернуть только число задач для свёрнутого проекта'
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  summaryOnly?: 'true' | 'false';
}
