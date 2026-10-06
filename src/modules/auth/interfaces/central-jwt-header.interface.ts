/** Поля заголовка JWT используются только для выбора проверяющего сервиса. */
export interface ICentralJwtHeader {
  alg?: unknown;
  kid?: unknown;
}
