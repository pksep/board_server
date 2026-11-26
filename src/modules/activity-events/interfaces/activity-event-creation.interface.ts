import type { CreateActivityEvent } from './activity-event.interface';

export interface ActivityEventCreationAttributes extends CreateActivityEvent {
  id?: number;
  createdAt?: Date;
}
