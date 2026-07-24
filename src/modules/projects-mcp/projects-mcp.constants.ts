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
  project_members_list: ProjectsMcpScope.Read,
  project_boards_list: ProjectsMcpScope.Read,
  project_tags_list: ProjectsMcpScope.Read,
  projects_create: ProjectsMcpScope.Create,
  projects_update: ProjectsMcpScope.Update,
  project_members_update: ProjectsMcpScope.Members,
  projects_delete: ProjectsMcpScope.Delete
};
