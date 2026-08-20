import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  Min
} from 'class-validator';

export class ReorderProjectsDto {
  @ApiProperty({
    example: [3, 1, 2],
    description: 'Полный список доступных проектов в нужном порядке'
  })
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids: number[];
}
