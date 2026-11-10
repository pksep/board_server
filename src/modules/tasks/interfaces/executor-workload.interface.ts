/** Одна задача даёт полную норму каждому её действующему исполнителю ERP. */
export interface ExecutorWorkloadTask {
  executorId: number;
  taskId: number;
  projectId: number;
  projectName: string;
  startDate: Date | null;
  dueDate: Date | null;
  timeNormMinutes: number | null;
  isDebt: boolean;
}
