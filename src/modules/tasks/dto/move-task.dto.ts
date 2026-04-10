import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber } from 'class-validator';

export class MoveTaskDto {
  @ApiProperty({ example: 2, description: 'ID целевой колонки' })
  @IsNumber()
  @IsNotEmpty()
  columnId: number;

  @ApiProperty({ example: 0, description: 'Новый порядок в колонке' })
  @IsNumber()
  @IsNotEmpty()
  order: number;
}
