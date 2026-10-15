export interface TaskCommentCounter {
  taskId: number;
  total: number;
  unread: number;
}

export interface TaskCommentCounters {
  taskIds: number[];
  total: number;
  unread: number;
  tasks: TaskCommentCounter[];
}

export interface ErpCommentCounter {
  entityId: number;
  total: number;
  unread: number;
}

export interface CounterRequestSession {
  cookies?: { access_token?: unknown };
  headers: { authorization?: string; origin?: string; referer?: string };
}
