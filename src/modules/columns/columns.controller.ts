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

@ApiTags('Колонки')
@Controller()
export class ColumnsController {
  constructor(private columnsService: ColumnsService) {}

  @ApiOperation({ summary: 'Колонки доски' })
  @Get('boards/:boardId/columns')
  getByBoard(@Param('boardId') boardId: number) {
    return this.columnsService.getByBoard(+boardId);
  }

  @ApiOperation({ summary: 'Создать колонку' })
  @Post('boards/:boardId/columns')
  create(@Param('boardId') boardId: number, @Body() dto: CreateColumnDto) {
    return this.columnsService.create(+boardId, dto);
  }

  @ApiOperation({ summary: 'Обновить колонку' })
  @Put('columns/:id')
  update(@Param('id') id: number, @Body() dto: UpdateColumnDto) {
    return this.columnsService.update(+id, dto);
  }

  @ApiOperation({ summary: 'Удалить колонку (soft delete)' })
  @Delete('columns/:id')
  delete(@Param('id') id: number) {
    return this.columnsService.delete(+id);
  }

  @ApiOperation({ summary: 'Переупорядочить колонки' })
  @Patch('boards/:boardId/columns/reorder')
  reorder(@Param('boardId') boardId: number, @Body() dto: ReorderColumnsDto) {
    return this.columnsService.reorder(+boardId, dto);
  }
}
