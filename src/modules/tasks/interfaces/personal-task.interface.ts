import type { Task } from '../model/task.model';
import type { ColumnStatus } from '../../columns/interfaces/column-status.interface';

export interface PersonalTaskLocation {
  id: number;
  projectId: number;
  projectPrefix: string;
  columnStatus: ColumnStatus | null;
  attributesOwnerOnly?: boolean;
}

export interface PersonalTaskItem {
  task: Task;
  projectId: number;
  projectPrefix: string;
  columnStatus: ColumnStatus | null;
  attributesOwnerOnly?: boolean;
}

export interface PersonalTaskPage {
  items: PersonalTaskItem[];
  offset: number;
  hasMore: boolean;
}
