import type { TaskTimeEntry } from '../tasks.service';
import type { ColumnStatus } from '../../columns/interfaces/column-status.interface';

/** Запись времени с привязкой к сотруднику ERP и доступной задаче. */
export interface TaskTimeReportEntry extends TaskTimeEntry {
  taskId: number;
  erpUserId: string | null;
  serviceNumber: string;
  taskTitle: string;
  taskNumber: number;
  projectId: number;
  projectTitle: string;
  projectPrefix: string;
  timeNormMinutes: number | null;
  columnStatus: ColumnStatus | null;
  taskTotalMinutes: number;
}

export interface TaskTimeReportPage {
  items: TaskTimeReportEntry[];
  nextCursor: number | null;
}

export interface StandaloneTimeReportEntry extends TaskTimeEntry {
  erpUserId: string | null;
  serviceNumber: string;
}

export interface StandaloneTimeReportPage {
  items: StandaloneTimeReportEntry[];
  nextCursor: number | null;
}
