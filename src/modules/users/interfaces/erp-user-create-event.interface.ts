/** Поля ERP user.create, которые использует синхронизация Board. */
export interface IErpUserCreatePayload {
  id: number | string;
  initials?: unknown;
  initial?: unknown;
  nickname?: unknown;
  login?: unknown;
  ex?: { tabel?: unknown };
  tabel?: unknown;
  serviceNumber?: unknown;
  avatarUrl?: unknown;
  image?: unknown;
  ban?: unknown;
  banned?: unknown;
  role?: unknown;
}

/** Конверт события создания пользователя ERP. */
export interface IErpUserCreateEvent {
  entity: IErpUserCreatePayload;
}

/** Проверенные значения для записи в локальную модель User. */
export interface IBoardUserSyncData {
  initial?: string;
  login?: string;
  serviceNumber?: string;
  image?: string;
  ban?: boolean;
  role?: string;
}
