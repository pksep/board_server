import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CreatePresignedUploadDto {
  @ApiProperty({
    example: 'screenshot.png',
    description: 'Оригинальное имя файла'
  })
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @ApiProperty({ example: 'image/png', description: 'MIME-тип файла' })
  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @ApiProperty({ example: 102400, description: 'Размер файла в байтах' })
  @IsNumber()
  @Min(1)
  size: number;
}
