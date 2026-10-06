import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as cookie from 'cookie';
import { InjectModel } from '@nestjs/sequelize';
import { Board } from '../boards/model/board.model';
import { ProjectAccessService } from '../projects/project-access.service';
import { IBoardSessionToken } from '../auth/interfaces/interface';
import { isCurrentBoardSession } from '../auth/utils/board-session';
import { AccessTokenService } from '../auth/access-token.service';
import type { IBoardSocket } from './interfaces/board-socket.interface';

const BOARD_SOCKET_PATH = process.env.BOARD_SOCKET_PATH || '/api/socket.io';
const BOARD_TOKEN_COOKIE = 'board_token';
const ERP_TOKEN_COOKIE = 'access_token';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: process.env.ALLOWED_ORIGIN || '*',
    credentials: true
  },
  namespace: '/board',
  path: BOARD_SOCKET_PATH
})
export class WsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(WsGateway.name);

  constructor(
    private jwtService: JwtService,
    @InjectModel(Board) private boardRepository: typeof Board,
    private projectAccess: ProjectAccessService,
    private accessTokenService: AccessTokenService
  ) {}

  @WebSocketServer()
  server: Server;

  // === Подключение / Отключение ===

  /** Подключает только сессию доски, выданную для текущей ERP-cookie через REST. */
  private verifySocketUser(
    cookies: Record<string, string>
  ): IBoardSessionToken | null {
    const token = cookies[BOARD_TOKEN_COOKIE];
    if (!token) return null;

    try {
      const user = this.jwtService.verify<object>(token);
      if (isCurrentBoardSession(user, cookies[ERP_TOKEN_COOKIE])) return user;
    } catch {
      // После смены аккаунта клиент сначала получает новую сессию штатным REST-запросом.
    }

    return null;
  }

  async handleConnection(client: Socket): Promise<void> {
    const boardClient = client as IBoardSocket;
    try {
      const cookies = cookie.parse(client.handshake.headers.cookie || '');

      if (this.accessTokenService.isEnabled()) {
        const accessToken = cookies[ERP_TOKEN_COOKIE];
        if (!accessToken) {
          this.logger.warn(`Client ${client.id} rejected: no access_token`);
          client.disconnect(true);
          return;
        }
        const user = await this.accessTokenService.authenticate(accessToken);
        boardClient.user = this.accessTokenService.toUserPayload(user);
        this.logger.log(`Client connected: ${client.id} (user: ${user.id})`);
        return;
      }

      const user = this.verifySocketUser(cookies);
      if (user) {
        boardClient.user = user;
        this.logger.log(`Client connected: ${client.id} (user: ${user.id})`);
      } else if (
        process.env.NODE_ENV !== 'production' &&
        !cookies[BOARD_TOKEN_COOKIE] &&
        !cookies[ERP_TOKEN_COOKIE]
      ) {
        // В dev-режиме подключение без токена допустимо
        boardClient.user = { id: 1, login: 'admin', serviceNumber: '001' };
        this.logger.log(`Client connected: ${client.id} (dev fallback)`);
      } else {
        this.logger.warn(`Client ${client.id} rejected: no token`);
        client.disconnect(true);
      }
    } catch (error) {
      this.logger.warn(`Client ${client.id} rejected: invalid token`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // === Подписка на комнаты ===

  @SubscribeMessage('board:join')
  async handleJoinBoard(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { boardId: number }
  ) {
    // handleConnection асинхронный: событие может прийти до проверки токена.
    if (!(client as IBoardSocket).user?.id) {
      return { event: 'error', data: { message: 'Не авторизован' } };
    }
    if (!data?.boardId || typeof data.boardId !== 'number') {
      return {
        event: 'error',
        data: { message: 'boardId is required and must be a number' }
      };
    }
    const board = await this.boardRepository.findByPk(data.boardId, {
      paranoid: false
    });
    if (!board) {
      return { event: 'error', data: { message: 'Доска не найдена' } };
    }
    try {
      await this.projectAccess.assertCanRead(
        board.projectId,
        Number((client as IBoardSocket).user?.id)
      );
    } catch {
      return { event: 'error', data: { message: 'Доска не найдена' } };
    }

    const room = `board:${data.boardId}`;
    await client.join(room);
    this.logger.log(`${client.id} joined ${room}`);
    return { event: 'board:joined', data: { boardId: data.boardId } };
  }

  @SubscribeMessage('board:leave')
  handleLeaveBoard(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { boardId: number }
  ) {
    if (!data?.boardId || typeof data.boardId !== 'number') {
      return {
        event: 'error',
        data: { message: 'boardId is required and must be a number' }
      };
    }
    const room = `board:${data.boardId}`;
    client.leave(room);
    this.logger.log(`${client.id} left ${room}`);
    return { event: 'board:left', data: { boardId: data.boardId } };
  }

  @SubscribeMessage('project:join')
  async handleJoinProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: number }
  ) {
    if (!(client as IBoardSocket).user?.id) {
      return { event: 'error', data: { message: 'Не авторизован' } };
    }
    if (!data?.projectId || typeof data.projectId !== 'number') {
      return {
        event: 'error',
        data: { message: 'projectId is required and must be a number' }
      };
    }
    try {
      await this.projectAccess.assertCanRead(
        data.projectId,
        Number((client as IBoardSocket).user?.id)
      );
    } catch {
      return { event: 'error', data: { message: 'Проект не найден' } };
    }

    const room = `project:${data.projectId}`;
    await client.join(room);
    this.logger.log(`${client.id} joined ${room}`);
    return { event: 'project:joined', data: { projectId: data.projectId } };
  }

  @SubscribeMessage('project:leave')
  handleLeaveProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: number }
  ) {
    if (!data?.projectId || typeof data.projectId !== 'number') {
      return {
        event: 'error',
        data: { message: 'projectId is required and must be a number' }
      };
    }
    const room = `project:${data.projectId}`;
    client.leave(room);
    return { event: 'project:left', data: { projectId: data.projectId } };
  }

  // === Методы эмита (вызываются из сервисов) ===

  /** Обновляет доступность исполнителя во всех открытых досках. */
  emitUserAvailabilityChanged(id: number, ban: boolean): void {
    this.server.emit('user:availability', { id, ban });
  }

  /** Задачи */
  emitTaskCreated(boardId: number, task: any) {
    this.server.to(`board:${boardId}`).emit('task:created', task);
  }

  emitTaskUpdated(boardId: number, task: any) {
    this.server.to(`board:${boardId}`).emit('task:updated', task);
  }

  emitTaskDeleted(boardId: number, taskId: number) {
    this.server.to(`board:${boardId}`).emit('task:deleted', { id: taskId });
  }

  emitTaskMoved(
    boardId: number,
    data: {
      taskId: number;
      taskIds: number[];
      fromColumnId: number;
      toColumnId: number;
      order: number;
    }
  ) {
    this.server.to(`board:${boardId}`).emit('task:moved', data);
  }

  emitTaskRelocated(
    sourceBoardId: number,
    targetBoardId: number,
    data: {
      task: any;
      taskIds: number[];
      fromProjectId: number;
      toProjectId: number;
      fromBoardId: number;
      toBoardId: number;
      fromColumnId: number;
      toColumnId: number;
      order: number;
    }
  ) {
    this.server
      .to([`board:${sourceBoardId}`, `board:${targetBoardId}`])
      .emit('task:relocated', data);
  }

  /** Колонки */
  emitColumnCreated(boardId: number, column: any) {
    this.server.to(`board:${boardId}`).emit('column:created', column);
  }

  emitColumnUpdated(boardId: number, column: any) {
    this.server.to(`board:${boardId}`).emit('column:updated', column);
  }

  emitColumnDeleted(boardId: number, columnId: number) {
    this.server.to(`board:${boardId}`).emit('column:deleted', { id: columnId });
  }

  emitColumnReordered(boardId: number, ids: number[]) {
    this.server.to(`board:${boardId}`).emit('column:reordered', { ids });
  }

  /** Проекты */
  emitProjectUpdated(projectId: number, project: any) {
    this.server.to(`project:${projectId}`).emit('project:updated', project);
  }

  emitProjectDeleted(projectId: number) {
    this.server
      .to(`project:${projectId}`)
      .emit('project:deleted', { id: projectId });
  }

  /** Доски */
  emitBoardReordered(projectId: number, ids: number[]) {
    this.server.to(`project:${projectId}`).emit('board:reordered', { ids });
  }
}
