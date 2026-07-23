import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ActivityEventsService } from './activity-events.service';
import { ActivityEvent } from './model/activity-event.model';

@Module({
  imports: [SequelizeModule.forFeature([ActivityEvent])],
  providers: [ActivityEventsService],
  exports: [ActivityEventsService]
})
export class ActivityEventsModule {}
