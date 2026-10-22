import { ApiProperty, PickType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { TaskListQueryDto } from './task-list-query.dto';

/** ПЗ передаёт идентификатор ERP; внутренние ID пользователей Board независимы. */
export class ExecutorTaskQueryDto extends PickType(TaskListQueryDto, [
  'limit',
  'offset'
] as const) {
  @ApiProperty({ minimum: 1, description: 'ID исполнителя в ERP' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  erpUserId: number;
}
