/** Ответ ERP /api/auth/check считается недоверенным до проверки полей. */
export interface IErpCheckResponse {
  ok?: unknown;
  user?: unknown;
}
