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
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { Project } from './model/project.model';
import { CurrentUser } from '../auth/current-user.decorator';
import { IUserDataToken } from '../auth/interfaces/interface';

@ApiTags('Проекты')
@Controller('projects')
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @ApiOperation({ summary: 'Получить все проекты' })
  @ApiResponse({ status: 200, type: [Project] })
  @Get()
  getAll(@CurrentUser() user: IUserDataToken) {
    return this.projectsService.getAll(user.id);
  }

  @ApiOperation({ summary: 'Получить проект по ID' })
  @ApiResponse({ status: 200, type: Project })
  @Get(':id')
  getById(@Param('id') id: number) {
    return this.projectsService.getById(+id);
  }

  @ApiOperation({ summary: 'Проверить уникальность префикса' })
  @Get('check-prefix/:prefix')
  checkPrefix(@Param('prefix') prefix: string) {
    return this.projectsService.checkPrefix(prefix);
  }

  @ApiOperation({ summary: 'Создать проект' })
  @ApiResponse({ status: 201, type: Project })
  @Post()
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: IUserDataToken) {
    return this.projectsService.create(dto, user.id);
  }

  @ApiOperation({ summary: 'Обновить проект' })
  @ApiResponse({ status: 200, type: Project })
  @Put(':id')
  update(
    @Param('id') id: number,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: IUserDataToken
  ) {
    dto.id = +id;
    return this.projectsService.update(dto, user.id);
  }

  @ApiOperation({ summary: 'Удалить проект (soft delete)' })
  @Delete(':id')
  delete(@Param('id') id: number) {
    return this.projectsService.delete(+id);
  }

  @ApiOperation({ summary: 'Toggle избранное' })
  @Patch(':id/favorite')
  toggleFavorite(@Param('id') id: number, @CurrentUser() user: IUserDataToken) {
    return this.projectsService.toggleFavorite(+id, user.id);
  }
}
