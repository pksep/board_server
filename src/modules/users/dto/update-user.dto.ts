import { ApiProperty } from '@nestjs/swagger';
import { EnumUserRole } from '../enums/role.enum';

export class UpdateUserDto {
  @ApiProperty({
    example: '2',
    default: null,
    type: String,
    description: 'Идентификатор пользователя'
  })
  readonly id: number | null;

  @ApiProperty({
    example: 'Иванов Иван Иванович',
    description: 'ФИО'
  })
  readonly initial: string;

  @ApiProperty({
    example: '12345',
    description: 'Табельный номер'
  })
  readonly serviceNumber: string;

  @ApiProperty({
    example: 'ivan_ivanov',
    description: 'Логин'
  })
  readonly login: string;

  @ApiProperty({
    example: 'admin',
    type: String,
    description: 'Роль пользователя',
    required: false
  })
  readonly role?: EnumUserRole | null;

  @ApiProperty({
    example: 'http://photo.png',
    description: 'Аватар пользователя',
    required: false
  })
  readonly image?: string | null;
}
