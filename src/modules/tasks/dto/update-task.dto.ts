import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsInt, IsObject, IsOptional, Min } from 'class-validator';
import { CreateTaskDto } from './create-task.dto';
import { TTaskAttributeValues } from '../../projects/interfaces/task-attribute.interface';

export class UpdateTaskDto extends PartialType(CreateTaskDto) {
  @ApiPropertyOptional({
    description:
      'Изменить только перечисленные атрибуты, сохранив остальные. null очищает значение.'
  })
  @IsOptional()
  @IsObject()
  customAttributeChanges?: TTaskAttributeValues;

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
