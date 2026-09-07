import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { UsersController } from './users.controller';
import { User } from './model/users.model';
import { UsersService } from './users.service';
import { UserSyncConsumer } from './user-sync.consumer';
import { TaskAssignee } from '../tasks/model/task-assignee.model';

@Module({
  controllers: [UsersController],
  providers: [UsersService, UserSyncConsumer],
  imports: [SequelizeModule.forFeature([User, TaskAssignee])],
  exports: [UsersService]
})
export class UsersModule {}
