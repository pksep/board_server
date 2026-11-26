import type { Task } from '../model/task.model';

export interface TaskListPage {
  items: Task[];
  total: number;
  rootTotal?: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}
