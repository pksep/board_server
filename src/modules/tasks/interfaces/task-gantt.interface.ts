import { ColumnStatus } from '../../columns/interfaces/column-status.interface';

/** Только поля списка и календаря: полная карточка читается через штатный getById. */
export interface TaskGanttItem {
  id: number;
  taskNumber: number;
  title: string;
  priority: string;
  startDate: Date | string;
  dueDate: Date | string | null;
  columnId: number;
  boardId: number;
  columnStatus: ColumnStatus | null;
  createdById: number;
  order: number;
  updatedAt: Date | string;
  assignees: { userId: number }[];
}

export interface TaskGanttSnapshot {
  items: TaskGanttItem[];
  total: number;
}
