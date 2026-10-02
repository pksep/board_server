export interface IUserDataToken {
  id: number;
  erpId?: string;
  serviceNumber: string;
  login: string;
  initial?: string;
  role?: string;
}

/** Сессия доски действительна только вместе с ERP-сессией, из которой выдана. */
export interface IBoardSessionToken extends IUserDataToken {
  erpTokenHash: string;
}
