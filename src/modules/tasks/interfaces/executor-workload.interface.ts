/** Минимальный факт назначения для календаря; executorId относится к ERP. */
export interface ExecutorWorkloadTask {
  executorId: number;
  taskId: number;
  projectId: number;
  projectName: string;
  startDate: Date | string | null;
  dueDate: Date | string | null;
  timeNormMinutes: number | null;
  isDebt?: boolean;
}
