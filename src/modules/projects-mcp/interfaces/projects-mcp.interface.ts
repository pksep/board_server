import { IUserDataToken } from 'src/modules/auth/interfaces/interface';

export interface ProjectsMcpAuthContext {
  user: IUserDataToken;
  clientId: string;
  audience: string;
  scopes: Set<string>;
  tokenExpiresAt?: number;
}

export interface ProjectsMcpRequest {
  body?: unknown;
  mcpAuth: ProjectsMcpAuthContext;
}

export interface ProjectsMcpOperationResult<T> {
  value: T;
  projectId?: number;
}
