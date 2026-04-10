import { ApiProperty } from '@nestjs/swagger';

export class CheckTabelUniqueDto {
  @ApiProperty({
    example: '001',
    description: 'Табель'
  })
  readonly serviceNumber: string;
}
