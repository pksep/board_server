import { ApiProperty } from '@nestjs/swagger';

export class BanUserDto {
  @ApiProperty({
    example: 2,
    description: 'Идентификатор пользователя'
  })
  readonly userId: number;
}
