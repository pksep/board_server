import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ConfigModule } from '@nestjs/config';
import { BoardsModule } from '../boards/boards.module';
import { ColumnsModule } from '../columns/columns.module';
import { ProjectsModule } from '../projects/projects.module';
import { TagsModule } from '../tags/tags.module';
import { TasksModule } from '../tasks/tasks.module';
import { User } from '../users/model/users.model';
import { UsersModule } from '../users/users.module';
import {
  ProjectsMcpController,
  ProjectsMcpMetadataController
} from './projects-mcp.controller';
import { ProjectsMcpAuthGuard } from './projects-mcp-auth.guard';
import { ProjectsMcpOperationsService } from './projects-mcp-operations.service';
import { ProjectsMcpServerService } from './projects-mcp-server.service';
import { ProjectsMcpTaskCommentsService } from './projects-mcp-task-comments.service';
import { McpProjectOperation } from './model/mcp-project-operation.model';

@Module({
  imports: [
    ConfigModule,
    ProjectsModule,
    BoardsModule,
    ColumnsModule,
    TagsModule,
    TasksModule,
    UsersModule,
    SequelizeModule.forFeature([McpProjectOperation, User])
  ],
  controllers: [ProjectsMcpController, ProjectsMcpMetadataController],
  providers: [
    ProjectsMcpAuthGuard,
    ProjectsMcpOperationsService,
    ProjectsMcpServerService,
    ProjectsMcpTaskCommentsService
  ]
})
export class ProjectsMcpModule {}
