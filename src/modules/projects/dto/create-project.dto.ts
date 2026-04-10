import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  MaxLength
} from 'class-validator';

export class CreateProjectDto {
  @ApiProperty({ example: 'Мой проект', description: 'Название проекта' })
  @IsString()
  @IsNotEmpty({ message: 'Название проекта обязательно' })
  title: string;

  @ApiProperty({
    example: 'PRJ',
    description: 'Уникальный префикс (мин. 3 англ. буквы)'
  })
  @IsString()
  @IsNotEmpty({ message: 'Префикс обязателен' })
  @MinLength(3, { message: 'Префикс должен содержать минимум 3 символа' })
  @MaxLength(10, { message: 'Префикс не более 10 символов' })
  @Matches(/^[A-Za-z]+$/, {
    message: 'Префикс должен содержать только английские буквы'
  })
  prefix: string;

  @ApiProperty({ example: 'Описание', description: 'Описание проекта' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: [1, 2], description: 'ID участников' })
  @IsOptional()
  membersIds?: number[];
}
