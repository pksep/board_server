import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as cookie from 'cookie';
import { InjectModel } from '@nestjs/sequelize';
import { Board } from '../boards/model/board.model';
import { ProjectAccessService } from '../projects/project-access.service';
import { IBoardSessionToken } from '../auth/interfaces/interface';
import { isCurrentBoardSession } from '../auth/utils/board-session';
import { AccessTokenService } from '../auth/access-token.service';
import type { IBoardSocket } from './interfaces/board-socket.interface';
import type { SessionSocket } from './interfaces/session-socket.interface';

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
export class WsGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    OnModuleDestroy
{
  private readonly logger = new Logger(WsGateway.name);
  private sessionTimer?: ReturnType<typeof setInterval>;
  private checkingSessions = false;

  /** Revalidates open central sessions, including sockets on another adapter node. */
  afterInit(): void {
    this.sessionTimer = setInterval(
      () => void this.revalidateConnections(),
      10000
    );
    this.sessionTimer.unref();
  }

  /** Releases background work on shutdown. */
  onModuleDestroy(): void {
    if (this.sessionTimer) clearInterval(this.sessionTimer);
  }

  /** Retains the legacy socket path when central auth is disabled. */
  async revalidateConnections(): Promise<void> {
    if (
      !this.server ||
      !this.accessTokenService.isEnabled() ||
      this.checkingSessions
    )
      return;
    this.checkingSessions = true;

    try {
      const sockets = await this.server.fetchSockets();
      await Promise.all(sockets.map(socket => this.validateSession(socket)));
    } catch {
      // A stopped adapter is retried on the next poll.
    } finally {
      this.checkingSessions = false;
    }
  }

  /** The saved access token cannot outlive revocation of its central session. */
  private async validateSession(socket: SessionSocket): Promise<boolean> {
    try {
      const user = await this.accessTokenService.authenticate(
        socket.data.accessToken
      );
      if (user.id !== socket.data.userId)
        throw new Error('Session user changed');

      return true;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) return false;
      socket.emit('auth:revoked');
      socket.disconnect(true);

      return false;
    }
  }

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
        client.data.accessToken = accessToken;
        client.data.userId = boardClient.user.id;
        await client.join(`user:${boardClient.user.id}`);
        client.emit('activity:ready');
        this.logger.log(`Client connected: ${client.id} (user: ${user.id})`);
        return;
      }

      const user = this.verifySocketUser(cookies);
      if (user) {
        boardClient.user = user;
        await client.join(`user:${user.id}`);
        client.emit('activity:ready');
        this.logger.log(`Client connected: ${client.id} (user: ${user.id})`);
      } else if (
        process.env.NODE_ENV !== 'production' &&
        !cookies[BOARD_TOKEN_COOKIE] &&
        !cookies[ERP_TOKEN_COOKIE]
      ) {
        // В dev-режиме подключение без токена допустимо
        boardClient.user = { id: 1, login: 'admin', serviceNumber: '001' };
        await client.join('user:1');
        client.emit('activity:ready');
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
    if (
      (client as IBoardSocket).user?.id &&
      this.accessTokenService.isEnabled() &&
      !(await this.validateSession(client))
    ) {
      return { event: 'error', data: { message: 'Не авторизован' } };
    }
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
    if (
      (client as IBoardSocket).user?.id &&
      this.accessTokenService.isEnabled() &&
      !(await this.validateSession(client))
    ) {
      return { event: 'error', data: { message: 'Не авторизован' } };
    }
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

  /** Личная инвалидация без текста задачи, идентификаторов проекта и чужих получателей. */
  emitTaskActivityChanged(userIds: number[], readOnly = false): void {
    const rooms = userIds.map(id => `user:${id}`);

    // Прочтение не меняет историю: клиенту достаточно сверить личные счётчики.
    if (readOnly) {
      this.emitToRooms(rooms, 'activity:changed', { readOnly: true });

      return;
    }

    this.emitToRooms(rooms, 'activity:changed');
  }

  /** Обновляет доступность исполнителя во всех открытых досках. */
  emitUserAvailabilityChanged(id: number, ban: boolean): void {
    this.emitToRooms([], 'user:availability', { id, ban });
  }

  /** Задачи */
  emitTaskCreated(boardId: number, task: any) {
    this.emitToRooms([`board:${boardId}`], 'task:created', task);
  }

  emitTaskUpdated(boardId: number, task: any) {
    this.emitToRooms([`board:${boardId}`], 'task:updated', task);
  }

  emitTaskDeleted(boardId: number, taskId: number) {
    this.emitToRooms([`board:${boardId}`], 'task:deleted', { id: taskId });
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
    this.emitToRooms([`board:${boardId}`], 'task:moved', data);
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
    this.emitToRooms(
      [`board:${sourceBoardId}`, `board:${targetBoardId}`],
      'task:relocated',
      data
    );
  }

  /** Колонки */
  emitColumnCreated(boardId: number, column: any) {
    this.emitToRooms([`board:${boardId}`], 'column:created', column);
  }

  emitColumnUpdated(boardId: number, column: any) {
    this.emitToRooms([`board:${boardId}`], 'column:updated', column);
  }

  emitColumnDeleted(boardId: number, columnId: number) {
    this.emitToRooms([`board:${boardId}`], 'column:deleted', { id: columnId });
  }

  emitColumnReordered(boardId: number, ids: number[]) {
    this.emitToRooms([`board:${boardId}`], 'column:reordered', { ids });
  }

  /** Проекты */
  emitProjectUpdated(projectId: number, project: any) {
    this.emitToRooms([`project:${projectId}`], 'project:updated', project);
  }

  emitProjectDeleted(projectId: number) {
    this.emitToRooms([`project:${projectId}`], 'project:deleted', {
      id: projectId
    });
  }

  /** Доски */
  emitBoardReordered(projectId: number, ids: number[]) {
    this.emitToRooms([`project:${projectId}`], 'board:reordered', { ids });
  }

  /** Uses the live session before delivering payloads; old deployments retain their path. */
  private emitToRooms(rooms: string[], event: string, payload?: unknown): void {
    if (!this.accessTokenService.isEnabled()) {
      const target = rooms.length ? this.server.to(rooms) : this.server;
      if (payload === undefined) target.emit(event);
      else target.emit(event, payload);

      return;
    }

    void this.emitToActiveSessions(rooms, event, payload);
  }

  /** Fetches adapter recipients so a remote revoked socket is also excluded. */
  private async emitToActiveSessions(
    rooms: string[],
    event: string,
    payload?: unknown
  ): Promise<void> {
    try {
      const target = rooms.length ? this.server.in(rooms) : this.server;
      const sockets = await target.fetchSockets();
      await Promise.all(
        sockets.map(async socket => {
          if (!(await this.validateSession(socket))) return;
          if (payload === undefined) socket.emit(event);
          else socket.emit(event, payload);
        })
      );
    } catch (error) {
      this.logger.warn(
        `Session delivery failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
