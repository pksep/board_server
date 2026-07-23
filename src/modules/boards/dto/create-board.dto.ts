import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDateString,
  MaxLength
} from 'class-validator';

export class CreateBoardDto {
  @ApiProperty({ example: 'Спринт 1', description: 'Название доски' })
  @IsString()
  @IsNotEmpty({ message: 'Название доски обязательно' })
  @MaxLength(255, {
    message: 'Название доски не должно превышать 255 символов'
  })
  title: string;

  @ApiProperty({ description: 'Дата начала' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({ description: 'Дата окончания' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
