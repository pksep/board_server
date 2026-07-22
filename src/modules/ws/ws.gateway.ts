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

@Injectable()
@WebSocketGateway({
  cors: {
    origin: process.env.ALLOWED_ORIGIN || '*',
    credentials: true
  },
  namespace: '/board'
})
export class WsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(WsGateway.name);

  constructor(
    private jwtService: JwtService,
    @InjectModel(Board) private boardRepository: typeof Board,
    private projectAccess: ProjectAccessService
  ) {}

  @WebSocketServer()
  server: Server;

  // === Подключение / Отключение ===

  handleConnection(client: Socket) {
    try {
      const cookies = cookie.parse(client.handshake.headers.cookie || '');
      const token = cookies['access_token'];
      if (token) {
        const user = this.jwtService.verify(token);
        (client as any).user = user;
        this.logger.log(`Client connected: ${client.id} (user: ${user.id})`);
      } else if (process.env.NODE_ENV !== 'production') {
        // В dev-режиме подключение без токена допустимо
        (client as any).user = { id: 1, login: 'admin', serviceNumber: '001' };
        this.logger.log(`Client connected: ${client.id} (dev fallback)`);
      } else {
        this.logger.warn(`Client ${client.id} rejected: no token`);
        client.disconnect(true);
      }
    } catch (error) {
      this.logger.warn(`Client ${client.id} rejected: invalid token`);
      if (process.env.NODE_ENV === 'production') {
        client.disconnect(true);
      } else {
        (client as any).user = { id: 1, login: 'admin', serviceNumber: '001' };
        this.logger.log(
          `Client connected: ${client.id} (dev fallback after error)`
        );
      }
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
    if (!data?.boardId || typeof data.boardId !== 'number') {
      return {
        event: 'error',
        data: { message: 'boardId is required and must be a number' }
      };
    }
    const board = await this.boardRepository.findByPk(data.boardId);
    if (!board) {
      return { event: 'error', data: { message: 'Доска не найдена' } };
    }
    try {
      await this.projectAccess.assertCanRead(
        board.projectId,
        Number((client as any).user?.id)
      );
    } catch {
      return { event: 'error', data: { message: 'Доска не найдена' } };
    }

    const room = `board:${data.boardId}`;
    client.join(room);
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
    if (!data?.projectId || typeof data.projectId !== 'number') {
      return {
        event: 'error',
        data: { message: 'projectId is required and must be a number' }
      };
    }
    try {
      await this.projectAccess.assertCanRead(
        data.projectId,
        Number((client as any).user?.id)
      );
    } catch {
      return { event: 'error', data: { message: 'Проект не найден' } };
    }

    const room = `project:${data.projectId}`;
    client.join(room);
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
