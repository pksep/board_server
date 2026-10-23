import type { TaskTimeEntry } from '../tasks.service';

/** Запись времени с привязкой к сотруднику ERP и доступной задаче. */
export interface TaskTimeReportEntry extends TaskTimeEntry {
  erpUserId: string | null;
  serviceNumber: string;
  taskTitle: string;
  taskNumber: number;
  projectId: number;
  projectTitle: string;
  projectPrefix: string;
}

export interface TaskTimeReportPage {
  items: TaskTimeReportEntry[];
  nextCursor: number | null;
}
