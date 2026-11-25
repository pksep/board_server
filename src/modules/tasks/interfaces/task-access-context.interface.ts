import type { Task } from '../model/task.model';
import type { BoardColumn } from '../../columns/model/board-column.model';
import type { Board } from '../../boards/model/board.model';
import type { ProjectReadAccessContext } from '../../projects/interfaces/project-read-access.interface';

/** Пакетный контекст не заменяет канонические проверки доступа и полей задачи. */
export interface TaskAccessContext {
  tasksById: Map<number, Task>;
  columnsById: Map<number, BoardColumn>;
  boardsById: Map<number, Board>;
  projectAccess: ProjectReadAccessContext;
  assigneeTaskIds?: Set<number>;
}

export interface TaskColumnLocation {
  column: BoardColumn;
  board: Board;
  projectId: number;
}
