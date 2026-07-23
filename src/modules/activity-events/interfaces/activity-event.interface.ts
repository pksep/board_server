import { Transaction } from 'sequelize';
import {
  ActivityActionType,
  ActivityEntityType
} from '../activity-events.constants';

export interface ActivityChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface CreateActivityEvent {
  projectId: number;
  entityType: ActivityEntityType;
  entityId: string;
  actionType: ActivityActionType;
  actorUserId?: number | null;
  changes?: ActivityChange[];
  metadata?: Record<string, unknown>;
}

export interface FindEntityActivity {
  projectId: number;
  entityType: ActivityEntityType;
  entityId: string;
  limit?: number;
  beforeId?: number;
}

export interface ActivityEventPage<T> {
  items: T[];
  nextCursor: number | null;
}

export interface ActivityEventWriteOptions {
  transaction: Transaction;
}
