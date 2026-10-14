import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf
} from 'class-validator';
import { ColumnStatus } from '../interfaces/column-status.interface';
import { ColumnMovePermission } from '../interfaces/column-move-permission.interface';

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

  @ApiProperty({
    enum: ColumnMovePermission,
    required: false,
    default: ColumnMovePermission.AnyActions
  })
  @ValidateIf((_object, value): boolean => value !== undefined)
  @IsEnum(ColumnMovePermission)
  movePermission?: ColumnMovePermission;
}
