import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTagDto {
  @ApiProperty({ example: 'Баг', description: 'Название тега' })
  @IsString()
  @IsNotEmpty({ message: 'Название тега обязательно' })
  label: string;

  @ApiProperty({
    example: 'var(--tag-pink, #FE3A8B)',
    description: 'CSS-цвет тега'
  })
  @IsString()
  @IsNotEmpty({ message: 'Цвет обязателен' })
  color: string;

  @ApiProperty({ example: 'Описание тега', description: 'Описание' })
  @IsOptional()
  @IsString()
  description?: string;
}
