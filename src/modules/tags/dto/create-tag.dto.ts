import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateTagDto {
  @ApiProperty({ example: 'Баг', description: 'Название тега' })
  @IsString()
  @IsNotEmpty({ message: 'Название тега обязательно' })
  @MaxLength(255)
  label: string;

  @ApiProperty({
    example: 'var(--tag-pink, #FE3A8B)',
    description: 'CSS-цвет тега'
  })
  @IsString()
  @IsNotEmpty({ message: 'Цвет обязателен' })
  @MaxLength(64)
  color: string;

  @ApiProperty({ example: 'Описание тега', description: 'Описание' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;
}
