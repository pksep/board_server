export const PROJECTS_MCP_AUDIENCE = 'board-projects-mcp';

export enum ProjectsMcpScope {
  Read = 'projects:read',
  Create = 'projects:create',
  Update = 'projects:update',
  Members = 'projects:members',
  Delete = 'projects:delete'
}

export const PROJECTS_MCP_SCOPES = Object.values(ProjectsMcpScope);

export const PROJECTS_MCP_TOOL_SCOPES: Record<string, ProjectsMcpScope> = {
  projects_list: ProjectsMcpScope.Read,
  projects_get: ProjectsMcpScope.Read,
  users_list: ProjectsMcpScope.Read,
  project_members_list: ProjectsMcpScope.Read,
  project_boards_list: ProjectsMcpScope.Read,
  project_tags_list: ProjectsMcpScope.Read,
  boards_get: ProjectsMcpScope.Read,
  board_columns_list: ProjectsMcpScope.Read,
  board_tasks_list: ProjectsMcpScope.Read,
  columns_get: ProjectsMcpScope.Read,
  column_tasks_list: ProjectsMcpScope.Read,
  tasks_get: ProjectsMcpScope.Read,
  task_subtasks_list: ProjectsMcpScope.Read,
  task_comments_list: ProjectsMcpScope.Read,
  task_history_list: ProjectsMcpScope.Read,
  projects_create: ProjectsMcpScope.Create,
  projects_update: ProjectsMcpScope.Update,
  project_members_update: ProjectsMcpScope.Members,
  projects_favorite_set: ProjectsMcpScope.Update,
  projects_reorder: ProjectsMcpScope.Update,
  project_tags_create: ProjectsMcpScope.Update,
  project_tags_update: ProjectsMcpScope.Update,
  boards_create: ProjectsMcpScope.Update,
  boards_update: ProjectsMcpScope.Update,
  boards_reorder: ProjectsMcpScope.Update,
  columns_create: ProjectsMcpScope.Update,
  columns_update: ProjectsMcpScope.Update,
  columns_reorder: ProjectsMcpScope.Update,
  tasks_create: ProjectsMcpScope.Update,
  subtasks_create: ProjectsMcpScope.Update,
  tasks_update: ProjectsMcpScope.Update,
  tasks_move: ProjectsMcpScope.Update,
  task_comments_create: ProjectsMcpScope.Update,
  project_tags_delete: ProjectsMcpScope.Delete,
  projects_delete: ProjectsMcpScope.Delete,
  boards_delete: ProjectsMcpScope.Delete,
  columns_delete: ProjectsMcpScope.Delete,
  tasks_delete: ProjectsMcpScope.Delete
};
