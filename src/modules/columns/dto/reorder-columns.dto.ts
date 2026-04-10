import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNumber } from 'class-validator';

export class ReorderColumnsDto {
  @ApiProperty({
    example: [3, 1, 2],
    description: 'Массив ID колонок в новом порядке'
  })
  @IsArray()
  @IsNumber({}, { each: true })
  ids: number[];
}
