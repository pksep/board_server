import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';
import { CreateTaskDto } from './create-task.dto';

export class UpdateTaskDto extends PartialType(CreateTaskDto) {
  @ApiPropertyOptional({
    type: Number,
    example: 42,
    nullable: true,
    description:
      'ID новой родительской задачи или null для открепления в корень доски'
  })
  @IsOptional()
  @IsInt({ message: 'parentTaskId должен быть целым числом или null' })
  @Min(1, { message: 'parentTaskId должен быть положительным числом' })
  parentTaskId?: number | null;
}
