import type { Task } from '../model/task.model';
import type { ColumnStatus } from '../../columns/interfaces/column-status.interface';

export interface PersonalTaskLocation {
  total: number;
  subtasksTotal: number;
  subtasksCompleted: number;
  id: number;
  projectId: number;
  projectPrefix: string;
  columnStatus: ColumnStatus | null;
}

export interface PersonalTaskSubtaskCounter {
  total: number;
  completed: number;
}

export interface PersonalTaskItem {
  subtaskCounter: PersonalTaskSubtaskCounter;
  task: Task;
  projectId: number;
  projectPrefix: string;
  columnStatus: ColumnStatus | null;
}

export interface PersonalTaskPage {
  total: number;
  items: PersonalTaskItem[];
  offset: number;
  hasMore: boolean;
}
