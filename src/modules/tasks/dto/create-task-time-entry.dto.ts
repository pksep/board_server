import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min
} from 'class-validator';

export class CreateTaskTimeEntryDto {
  @ApiProperty({
    example: 80,
    description: 'Фактическое время выполнения в минутах'
  })
  @IsInt()
  @Min(1)
  @Max(525600)
  durationMinutes: number;

  @ApiPropertyOptional({
    example: 'Проверил макет и исправил замечания',
    description: 'Необязательный комментарий пользователя'
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
