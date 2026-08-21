import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Put
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BoardsService } from './boards.service';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';
import { ReorderBoardsDto } from './dto/reorder-boards.dto';
import { Board } from './model/board.model';
import { CurrentUser } from '../auth/current-user.decorator';
import { IUserDataToken } from '../auth/interfaces/interface';
import { BoardListQueryDto } from './dto/board-list-query.dto';

@ApiTags('Доски')
@Controller()
export class BoardsController {
  constructor(private boardsService: BoardsService) {}

  @ApiOperation({ summary: 'Доски проекта' })
  @ApiResponse({ status: 200, type: [Board] })
  @Get('projects/:projectId/boards')
  getByProject(
    @Param('projectId') projectId: number,
    @Query() query: BoardListQueryDto,
    @CurrentUser() user: IUserDataToken
  ) {
    return this.boardsService.getByProject(+projectId, user.id, query);
  }

  @ApiOperation({ summary: 'Получить доску с колонками' })
  @ApiResponse({ status: 200, type: Board })
  @Get('boards/:id')
  getById(@Param('id') id: number, @CurrentUser() user: IUserDataToken) {
    return this.boardsService.getById(+id, user.id);
  }

  @ApiOperation({ summary: 'Создать доску' })
  @ApiResponse({ status: 201, type: Board })
  @Post('projects/:projectId/boards')
  create(
    @Param('projectId') projectId: number,
    @Body() dto: CreateBoardDto,
    @CurrentUser() user: IUserDataToken
  ) {
    return this.boardsService.create(+projectId, dto, user.id);
  }

  @ApiOperation({ summary: 'Обновить доску' })
  @Put('boards/:id')
  update(
    @Param('id') id: number,
    @Body() dto: UpdateBoardDto,
    @CurrentUser() user: IUserDataToken
  ) {
    return this.boardsService.update(+id, dto, user.id);
  }

  @ApiOperation({ summary: 'Изменить порядок досок' })
  @Patch('projects/:projectId/boards/reorder')
  reorder(
    @Param('projectId') projectId: number,
    @Body() dto: ReorderBoardsDto,
    @CurrentUser() user: IUserDataToken
  ) {
    return this.boardsService.reorder(+projectId, dto.ids, user.id);
  }

  @ApiOperation({ summary: 'Удалить доску (soft delete)' })
  @Delete('boards/:id')
  delete(@Param('id') id: number, @CurrentUser() user: IUserDataToken) {
    return this.boardsService.delete(+id, user.id);
  }
}
