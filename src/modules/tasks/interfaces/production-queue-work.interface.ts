export interface ProductionQueueWorkRequest {
  resourceId: number;
  taskIds: number[];
  actorErpId?: number;
  includeAssigned?: boolean;
}

export interface ProductionQueueResourcesResponse {
  resourceIds: number[];
}

export interface ProductionQueueWorkResponse {
  items?: ProductionQueueWork[];
  error?: string;
  status?: number;
}

export interface ProductionQueueWork {
  taskId: number;
  title: string;
  timeNormMinutes: number;
  dueDate?: Date | string | null;
  startDate?: Date | string | null;
  startDateRevision?: number;
}

export interface ProductionQueueTaskDate {
  taskId: number;
  startTime: string | null;
  isManualStartTime: boolean;
}

export interface ProductionQueueDates {
  resourceId: number;
  version: string;
  tasks: ProductionQueueTaskDate[];
}
