import { ApiProperty } from '@nestjs/swagger';

export class GetUsersDto {
  @ApiProperty({
    example: true,
    description: 'Нужны ли все данные',
    default: false
  })
  readonly light: boolean;

  @ApiProperty({
    example: false,
    description: 'Забанены ли пользователи',
    default: false
  })
  readonly ban: boolean;

  @ApiProperty({
    example: '',
    description: 'Строка поиска'
  })
  readonly searchSring: string;

  @ApiProperty({
    example: 1,
    description: 'Страница пагинации',
    default: 1
  })
  readonly page: number;

  @ApiProperty({
    example: false,
    description: 'Получить пользователей из архива',
    default: false
  })
  readonly isBan: boolean = false;

  @ApiProperty({
    example: [1, 2, 3],
    description: 'Массив id, по которым ищем пользователей (необязательно)',
    required: false
  })
  readonly ids: number[];
}
