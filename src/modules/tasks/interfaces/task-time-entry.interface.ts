export interface TaskTimeEntryRecord {
  createdById: number;
  actorId: number;
  actorImage: string | null;
  actorInitial: string | null;
  actorLogin: string;
  comment: string | null;
  createdAt: Date | string;
  durationMinutes: number;
  id: number;
  taskId: number | null;
  userId: number;
}

export interface TaskTimeEntry {
  createdById: number;
  actor: {
    id: number;
    image: string | null;
    initial: string | null;
    login: string;
  };
  comment: string | null;
  createdAt: Date | string;
  durationMinutes: number;
  id: number;
  taskId: number | null;
  userId: number;
}

export interface TaskTimeEntryPage {
  items: TaskTimeEntry[];
  nextCursor: number | null;
  totalMinutes: number;
}

export type TaskTimeEntryPageRecord = (TaskTimeEntryRecord | { id: null }) & {
  totalMinutes: number;
};
