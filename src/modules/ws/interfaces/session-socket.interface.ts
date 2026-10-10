import { Socket } from 'socket.io';

/** Both local and remote adapter sockets support session revocation. */
export type SessionSocket = Pick<Socket, 'data' | 'emit'> & {
  disconnect(close?: boolean): unknown;
};
