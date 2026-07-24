import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Equals, IsOptional } from 'class-validator';
import { CreateTaskDto } from './create-task.dto';

export class UpdateTaskDto extends PartialType(CreateTaskDto) {
  @ApiPropertyOptional({
    type: Number,
    example: null,
    nullable: true,
    description: 'Передайте null, чтобы открепить задачу от родительской'
  })
  @IsOptional()
  @Equals(null, {
    message: 'parentTaskId поддерживает только открепление значением null'
  })
  parentTaskId?: null;
}
