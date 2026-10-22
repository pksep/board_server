/** Доверие к сессии проверяет общий guard; справочник использует только ERP-токен. */
export interface IUserDirectoryRequest {
  cookies?: { access_token?: unknown };
  headers?: { authorization?: unknown };
}
