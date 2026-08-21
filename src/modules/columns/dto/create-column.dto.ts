import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateColumnDto {
  @ApiProperty({ example: 'В работе', description: 'Название колонки' })
  @IsString()
  @IsNotEmpty({ message: 'Название колонки обязательно' })
  @MaxLength(255)
  title: string;

  @ApiProperty({ example: '#548CF6', description: 'CSS-цвет' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  color?: string;
}
