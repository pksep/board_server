import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { Project } from './model/project.model';
import { ProjectMember } from './model/project-member.model';
import { UserFavorite } from './model/user-favorite.model';
import { ProjectAccessService } from './project-access.service';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectAccessService],
  imports: [SequelizeModule.forFeature([Project, ProjectMember, UserFavorite])],
  exports: [ProjectsService, ProjectAccessService]
})
export class ProjectsModule {}
