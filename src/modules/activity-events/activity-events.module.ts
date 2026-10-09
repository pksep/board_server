import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ActivityEventsService } from './activity-events.service';
import { ActivityEvent } from './model/activity-event.model';
import { ActivityEventRecipient } from './model/activity-event-recipient.model';
import { TaskActivityController } from './task-activity.controller';
import { TaskActivityService } from './task-activity.service';

@Module({
  imports: [
    SequelizeModule.forFeature([ActivityEvent, ActivityEventRecipient])
  ],
  controllers: [TaskActivityController],
  providers: [ActivityEventsService, TaskActivityService],
  exports: [ActivityEventsService]
})
export class ActivityEventsModule {}
