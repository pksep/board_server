import { ApiProperty } from '@nestjs/swagger';

export class AuthUserDto {
  @ApiProperty({ example: '001', description: 'Табельный номер' })
  readonly serviceNumber: string;

  @ApiProperty({ example: 'Admin.A.A', description: 'Ямя пользователя' })
  readonly login: string;

  @ApiProperty({ example: '5FcS%#2w', description: 'Пароль пользователя' })
  readonly password: string;
}
