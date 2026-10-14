import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsDateString,
  MaxLength,
  IsArray,
  ArrayUnique,
  ValidateIf
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

  @ApiProperty({
    description: 'ID текущей доски, из которой нужно скопировать столбцы',
    required: false
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  sourceBoardId?: number;

  @ApiProperty({
    type: [Number],
    required: false,
    description:
      'ID участников проекта. Если не переданы, выбираются все действующие участники'
  })
  @ValidateIf((_object, value): boolean => value !== undefined)
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @IsPositive({ each: true })
  membersIds?: number[];
}
