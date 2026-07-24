export const PROJECTS_MCP_AUDIENCE = 'board-projects-mcp';

export enum ProjectsMcpScope {
  Read = 'projects:read',
  Create = 'projects:create',
  Update = 'projects:update',
  Members = 'projects:members',
  Delete = 'projects:delete'
}

export const PROJECTS_MCP_SCOPES = Object.values(ProjectsMcpScope);
