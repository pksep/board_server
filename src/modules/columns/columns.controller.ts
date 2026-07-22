import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ColumnsService } from './columns.service';
import { CreateColumnDto } from './dto/create-column.dto';
import { UpdateColumnDto } from './dto/update-column.dto';
import { ReorderColumnsDto } from './dto/reorder-columns.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { IUserDataToken } from '../auth/interfaces/interface';

@ApiTags('Колонки')
@Controller()
export class ColumnsController {
  constructor(private columnsService: ColumnsService) {}

  @ApiOperation({ summary: 'Колонки доски' })
  @Get('boards/:boardId/columns')
  getByBoard(
    @Param('boardId') boardId: number,
    @CurrentUser() user: IUserDataToken
  ) {
    return this.columnsService.getByBoard(+boardId, user.id);
  }

  @ApiOperation({ summary: 'Создать колонку' })
  @Post('boards/:boardId/columns')
  create(
    @Param('boardId') boardId: number,
    @Body() dto: CreateColumnDto,
    @CurrentUser() user: IUserDataToken
  ) {
    return this.columnsService.create(+boardId, dto, user.id);
  }

  @ApiOperation({ summary: 'Обновить колонку' })
  @Put('columns/:id')
  update(
    @Param('id') id: number,
    @Body() dto: UpdateColumnDto,
    @CurrentUser() user: IUserDataToken
  ) {
    return this.columnsService.update(+id, dto, user.id);
  }

  @ApiOperation({ summary: 'Удалить колонку (soft delete)' })
  @Delete('columns/:id')
  delete(@Param('id') id: number, @CurrentUser() user: IUserDataToken) {
    return this.columnsService.delete(+id, user.id);
  }

  @ApiOperation({ summary: 'Переупорядочить колонки' })
  @Patch('boards/:boardId/columns/reorder')
  reorder(
    @Param('boardId') boardId: number,
    @Body() dto: ReorderColumnsDto,
    @CurrentUser() user: IUserDataToken
  ) {
    return this.columnsService.reorder(+boardId, dto, user.id);
  }
}
