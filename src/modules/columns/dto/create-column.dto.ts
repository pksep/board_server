import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength
} from 'class-validator';
import { ColumnStatus } from '../interfaces/column-status.interface';

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

  @ApiProperty({ enum: ColumnStatus, required: false, nullable: true })
  @IsOptional()
  @IsEnum(ColumnStatus)
  status?: ColumnStatus | null;
}
