import type { Task } from '../model/task.model';
import type { ColumnStatus } from '../../columns/interfaces/column-status.interface';
import type { ITaskAttributeDefinition } from '../../projects/interfaces/task-attribute.interface';
import type { User } from '../../users/model/users.model';

/** Только подписи полей выбранной задачи; не каталог чужого проекта. */
export interface ExecutorTaskDisplayContext {
  projectTitle: string;
  boardId: number;
  boardTitle: string;
  columnTitle: string;
  taskAttributeDefinitions: ITaskAttributeDefinition[];
  users: Pick<User, 'id' | 'login' | 'initial' | 'image'>[];
  parentTask?: Pick<Task, 'id' | 'title' | 'taskNumber' | 'parentTaskId'>;
}

export interface PersonalTaskLocation {
  total: number;
  subtasksTotal: number;
  subtasksCompleted: number;
  id: number;
  projectId: number;
  projectPrefix: string;
  columnStatus: ColumnStatus | null;
  attributesOwnerOnly?: boolean;
  canReadTask?: boolean;
  displayContext?: Omit<ExecutorTaskDisplayContext, 'users' | 'parentTask'>;
}

/** Прогресс активных подзадач для общего компонента карточки. */
export interface PersonalTaskSubtaskCounter {
  total: number;
  completed: number;
}

export interface PersonalTaskItem {
  task: Task;
  projectId: number;
  projectPrefix: string;
  columnStatus: ColumnStatus | null;
  subtaskCounter: PersonalTaskSubtaskCounter;
  attributesOwnerOnly?: boolean;
  canReadTask?: boolean;
  displayContext?: ExecutorTaskDisplayContext;
}

export interface PersonalTaskPage {
  total: number;
  items: PersonalTaskItem[];
  offset: number;
  hasMore: boolean;
}
