import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TagsService } from './tags.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { ProjectTag } from './model/project-tag.model';

@ApiTags('Теги проекта')
@Controller()
export class TagsController {
  constructor(private tagsService: TagsService) {}

  @ApiOperation({ summary: 'Получить все теги проекта' })
  @ApiResponse({ status: 200, type: [ProjectTag] })
  @Get('projects/:projectId/tags')
  getByProject(@Param('projectId') projectId: number) {
    return this.tagsService.getByProject(+projectId);
  }

  @ApiOperation({ summary: 'Создать тег' })
  @ApiResponse({ status: 201, type: ProjectTag })
  @Post('projects/:projectId/tags')
  create(@Param('projectId') projectId: number, @Body() dto: CreateTagDto) {
    return this.tagsService.create(+projectId, dto);
  }

  @ApiOperation({ summary: 'Обновить тег' })
  @ApiResponse({ status: 200, type: ProjectTag })
  @Put('tags/:id')
  update(@Param('id') id: number, @Body() dto: UpdateTagDto) {
    return this.tagsService.update(+id, dto);
  }

  @ApiOperation({ summary: 'Удалить тег (soft delete)' })
  @Delete('tags/:id')
  delete(@Param('id') id: number) {
    return this.tagsService.delete(+id);
  }
}
