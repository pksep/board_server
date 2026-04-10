import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { CreateProjectDto } from './create-project.dto';
import { IsNumber, IsOptional } from 'class-validator';

// Исключаем prefix из обновляемых полей:
// смена префикса сломает отображение номеров задач (PRJ-1 → ???-1)
export class UpdateProjectDto extends PartialType(
  OmitType(CreateProjectDto, ['prefix'] as const)
) {
  @ApiProperty({ example: 1, description: 'ID проекта' })
  @IsOptional()
  @IsNumber()
  id: number;
}
