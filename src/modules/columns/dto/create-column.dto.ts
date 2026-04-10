import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateColumnDto {
  @ApiProperty({ example: 'В работе', description: 'Название колонки' })
  @IsString()
  @IsNotEmpty({ message: 'Название колонки обязательно' })
  title: string;

  @ApiProperty({ example: '#548CF6', description: 'CSS-цвет' })
  @IsOptional()
  @IsString()
  color?: string;
}
