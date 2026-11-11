export interface TaskCommentCounter {
  taskId: number;
  total: number;
  unread: number;
}

/** Только поля уже загруженной задачи, необходимые для добавления счётчика. */
export interface TaskCommentSnapshot {
  id: number;
  subtasks?: TaskCommentSnapshot[];
  setDataValue(key: 'commentsCount', value: number): void;
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
