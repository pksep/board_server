import type { Socket } from 'socket.io';
import type { IUserDataToken } from '../../auth/interfaces/interface';

/** Socket.IO-клиент после проверки access-токена Board. */
export type IBoardSocket = Socket & {
  user?: IUserDataToken;
};
