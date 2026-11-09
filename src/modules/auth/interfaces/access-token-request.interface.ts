import type { User } from '../../users/model/users.model';
import type { IExternalAuthUser } from './external-auth-user.interface';

/** Raw cookie headers retain duplicates lost by cookie-parser. */
export interface IAccessTokenRequest {
  headers?: { cookie?: string; authorization?: string };
  cookies?: Record<string, unknown>;
}

export interface IAuthenticatedAccessToken {
  token: string;
  user: User;
}

/** Verified authority response; not synchronized until token selection is unique. */
export interface IVerifiedAccessToken {
  token: string;
  externalUser: IExternalAuthUser;
  isCentral: boolean;
}
