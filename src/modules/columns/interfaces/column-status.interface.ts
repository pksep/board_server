export enum ColumnStatus {
  Queued = 'queued',
  InProgress = 'in_progress',
  Completed = 'completed',
  Archived = 'archived'
}

/** Старые клиенты записывают прежний статус в общий тип завершения и проверки. */
export function normalizeLegacyColumnStatus<T>(
  value: T
): T | ColumnStatus.Completed {
  return value === 'in_review' ? ColumnStatus.Completed : value;
}
