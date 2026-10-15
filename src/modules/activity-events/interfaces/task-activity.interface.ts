import {
  ActivityActionType,
  ActivityEntityType
} from '../activity-events.constants';
import { ActivityChange, ActivityEventPage } from './activity-event.interface';

export interface TaskActivityPage extends ActivityEventPage<TaskActivityItem> {
  accessibleProjectIds: number[];
}

export interface TaskActivityReadResult {
  throughEventId: number;
}

export interface TaskActivityItem {
  id: number;
  projectId: number;
  entityId: string;
  entityType: ActivityEntityType;
  actionType: ActivityActionType;
  actorUserId: number | null;
  actor: {
    id: number;
    login: string;
    initial: string;
    image: string | null;
  } | null;
  changes: ActivityChange[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  readAt: Date | null;
  isRecipient: boolean;
  taskId: number;
  taskProjectId: number;
  taskTitle: string;
  taskNumber: number;
  projectPrefix: string;
}

export interface TaskActivityCounts {
  total: number;
  projects: Record<string, number>;
}
