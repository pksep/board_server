export interface ProjectTaskRoleRule {
  moveToColumnIds?: number[] | null;
  moveFromColumnIds?: number[] | null;
  canEditAttributes?: boolean | null;
}

export interface ProjectTaskCreationRule {
  userIds: number[];
  columnIds: number[];
}

export interface TaskPermissionRules {
  assignee?: ProjectTaskRoleRule | null;
  responsible?: ProjectTaskRoleRule | null;
  controller?: ProjectTaskRoleRule | null;
  createUserIds?: number[] | null;
  createRules?: ProjectTaskCreationRule[] | null;
}

export interface BoardTaskPermissionRules extends TaskPermissionRules {
  boardId: number;
}

export interface ProjectTaskPermissions extends TaskPermissionRules {
  boards?: BoardTaskPermissionRules[] | null;
}
