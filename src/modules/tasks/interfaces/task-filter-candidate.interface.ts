import type { Task } from '../model/task.model';

/** Projection loaded before applying column-task filters and resolving roots. */
export type TaskFilterCandidate = Pick<Task, 'id' | 'parentTaskId'> &
  Partial<Pick<Task, 'createdById' | 'startDate' | 'dueDate' | 'priority'>>;
