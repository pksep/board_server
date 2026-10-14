import type { Task } from '../model/task.model';

export interface PersonalTaskLocation {
  id: number;
  projectId: number;
  projectPrefix: string;
}

export interface PersonalTaskItem {
  task: Task;
  projectId: number;
  projectPrefix: string;
}

export interface PersonalTaskPage {
  items: PersonalTaskItem[];
  offset: number;
  hasMore: boolean;
}
