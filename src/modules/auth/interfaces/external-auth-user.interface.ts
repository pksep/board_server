/** Нормализованный пользователь из ERP или SEP Auth перед синхронизацией с Board. */
export interface IExternalAuthUser {
  id: number | string;
  login?: string;
  initial?: string;
  tabel?: string;
  serviceNumber?: string;
  image?: string | null;
  role?: string;
  ban?: boolean;
}
