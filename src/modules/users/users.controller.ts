import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { UserId } from '../auth/user-id.decorator';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';
import { User } from './model/users.model';
import { BanUserDto } from './dto/ban-user.dto';
import { GetUsersDto } from './dto/get-users.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { CheckTabelUniqueDto } from './dto/tabel-unique.dto';
import { UserDirectoryService } from './user-directory.service';
import type { IUserDirectoryRequest } from './interfaces/user-directory-request.interface';

@ApiTags('Пользователи')
@Controller('users')
export class UsersController {
  constructor(
    private userService: UsersService,
    private readonly directory: UserDirectoryService
  ) {}

  @ApiOperation({ summary: 'Создание пользователей' })
  @ApiResponse({ status: 200, type: User })
  @Post()
  createUser(@Body() dto: CreateUserDto, @UserId() userId: number) {
    return this.userService.createUser(dto, userId);
  }

  @ApiOperation({ summary: 'Обновление пользователя' })
  @Post('/update')
  @ApiResponse({ status: 200, type: User })
  updateUser(@Body() dto: UpdateUserDto, @UserId() userId: number) {
    return this.userService.updateUser(dto, userId);
  }

  @ApiOperation({ summary: 'Проверяем наличие табеля' })
  @Post('/tabel/unique')
  checkNameUnique(@Body() dto: CheckTabelUniqueDto) {
    return this.userService.checkTabelUnique(dto);
  }

  @ApiOperation({ summary: 'Получение всех пользователей' })
  @ApiResponse({ status: 200, type: [User] })
  @Post('/pagination/all')
  getAllWithPagination(@Body() dto: GetUsersDto) {
    return this.userService.getUsersPagination(dto);
  }

  @ApiOperation({ summary: 'Бан пользоватиелей' })
  @ApiResponse({ status: 200 })
  @Post('/ban')
  banUser(@Body() dto: BanUserDto, @UserId() userId: number) {
    return this.userService.userToArchive(dto, userId);
  }

  @ApiOperation({
    summary: 'Получение минимальные данные для всех актуальных пользователей'
  })
  @ApiResponse({ status: 200, type: [User] })
  @Get('/list')
  /** Возвращает сотрудников, включая созданных до подключения доски к ERP. */
  async getAllList(@Req() request: IUserDirectoryRequest): Promise<User[]> {
    await this.directory.ensureMissingUsers(request);

    return this.userService.getUsersList();
  }

  @ApiParam({
    name: 'id',
    description: 'Идентификатор пользователя к получению',
    required: true,
    type: Number,
    schema: { default: 1 }
  })
  @ApiOperation({ summary: 'Получение пользователя по ID' })
  @Get('/:id')
  getUserById(@Param('id') id: number) {
    return this.userService.getUserByPk(id);
  }
}
