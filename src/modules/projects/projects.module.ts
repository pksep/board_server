import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { Project } from './model/project.model';
import { ProjectMember } from './model/project-member.model';
import { UserFavorite } from './model/user-favorite.model';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService],
  imports: [SequelizeModule.forFeature([Project, ProjectMember, UserFavorite])],
  exports: [ProjectsService]
})
export class ProjectsModule {}
