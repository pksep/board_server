export interface ProductionQueueWorkRequest {
  resourceId: number;
  taskIds: number[];
  actorErpId?: number;
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
