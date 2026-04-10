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
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BoardsService } from './boards.service';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';
import { Board } from './model/board.model';

@ApiTags('Доски')
@Controller()
export class BoardsController {
  constructor(private boardsService: BoardsService) {}

  @ApiOperation({ summary: 'Доски проекта' })
  @ApiResponse({ status: 200, type: [Board] })
  @Get('projects/:projectId/boards')
  getByProject(@Param('projectId') projectId: number) {
    return this.boardsService.getByProject(+projectId);
  }

  @ApiOperation({ summary: 'Получить доску с колонками' })
  @ApiResponse({ status: 200, type: Board })
  @Get('boards/:id')
  getById(@Param('id') id: number) {
    return this.boardsService.getById(+id);
  }

  @ApiOperation({ summary: 'Создать доску' })
  @ApiResponse({ status: 201, type: Board })
  @Post('projects/:projectId/boards')
  create(@Param('projectId') projectId: number, @Body() dto: CreateBoardDto) {
    return this.boardsService.create(+projectId, dto);
  }

  @ApiOperation({ summary: 'Обновить доску' })
  @Put('boards/:id')
  update(@Param('id') id: number, @Body() dto: UpdateBoardDto) {
    return this.boardsService.update(+id, dto);
  }

  @ApiOperation({ summary: 'Изменить порядок досок' })
  @Patch('projects/:projectId/boards/reorder')
  reorder(
    @Param('projectId') projectId: number,
    @Body() body: { ids: number[] }
  ) {
    return this.boardsService.reorder(+projectId, body.ids);
  }

  @ApiOperation({ summary: 'Удалить доску (soft delete)' })
  @Delete('boards/:id')
  delete(@Param('id') id: number) {
    return this.boardsService.delete(+id);
  }
}
