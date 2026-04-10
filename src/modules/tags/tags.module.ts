import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';
import { ProjectTag } from './model/project-tag.model';
import { TaskTag } from '../tasks/model/task-tag.model';

@Module({
  controllers: [TagsController],
  providers: [TagsService],
  imports: [SequelizeModule.forFeature([ProjectTag, TaskTag])],
  exports: [TagsService]
})
export class TagsModule {}
