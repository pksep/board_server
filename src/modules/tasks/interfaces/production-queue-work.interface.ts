export interface ProductionQueueWorkRequest {
  resourceId: number;
  taskIds: number[];
  actorErpId?: number;
}

export interface ProductionQueueWorkResponse {
  items?: { taskId: number; title: string; timeNormMinutes: number }[];
  error?: string;
  status?: number;
}

export interface ProductionQueueDates {
  resourceId: number;
  version: string;
  tasks: {
    taskId: number;
    startTime: string | null;
    isManualStartTime: boolean;
  }[];
}
