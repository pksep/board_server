import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateAttachmentDto {
  @ApiProperty({
    example: 'document.pdf',
    description: 'Оригинальное имя файла'
  })
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @ApiProperty({ example: 'application/pdf', description: 'MIME-тип' })
  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @ApiProperty({ example: 102400, description: 'Размер файла в байтах' })
  @IsNumber()
  @IsNotEmpty()
  size: number;

  @ApiProperty({
    example: 'tasks/1/uuid.pdf',
    required: false,
    description: 'Нужно передавать только при подтверждении (confirm)'
  })
  @IsString()
  @IsOptional()
  objectName?: string;
}
