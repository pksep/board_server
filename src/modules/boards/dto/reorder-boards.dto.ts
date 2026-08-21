import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  Min
} from 'class-validator';

export class ReorderBoardsDto {
  @ApiProperty({
    example: [3, 1, 2],
    description: 'Полный список досок проекта в нужном порядке'
  })
  @IsArray()
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids: number[];
}
