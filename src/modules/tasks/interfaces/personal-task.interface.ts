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
  attributesOwnerOnly?: boolean;
}

/** Прогресс активных подзадач для общего компонента карточки. */
export interface PersonalTaskSubtaskCounter {
  total: number;
  completed: number;
}

export interface PersonalTaskItem {
  task: Task;
  projectId: number;
  projectPrefix: string;
  columnStatus: ColumnStatus | null;
  subtaskCounter: PersonalTaskSubtaskCounter;
  attributesOwnerOnly?: boolean;
}

export interface PersonalTaskPage {
  total: number;
  items: PersonalTaskItem[];
  offset: number;
  hasMore: boolean;
}
