import { BadGatewayException, HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { TasksService } from '../tasks/tasks.service';
import { ProjectsMcpAuthContext } from './interfaces/projects-mcp.interface';

type CreateTaskCommentInput = {
  content: string;
  threadId?: string;
  answerCommentId?: string;
};

@Injectable()
export class ProjectsMcpTaskCommentsService {
  constructor(
    private configService: ConfigService,
    private tasksService: TasksService
  ) {}

  async list(
    taskId: number,
    page: number,
    limit: number,
    auth: ProjectsMcpAuthContext
  ): Promise<unknown> {
    await this.tasksService.getById(taskId, auth.user.id);

    return this.request(
      auth,
      'get',
      `/comments/by-entity/tasks/${taskId}`,
      undefined,
      { page, limit }
    );
  }

  async create(
    taskId: number,
    input: CreateTaskCommentInput,
    auth: ProjectsMcpAuthContext
  ): Promise<unknown> {
    await this.tasksService.getById(taskId, auth.user.id);

    return this.request(auth, 'post', '/comments/create', {
      content: input.content,
      entityId: taskId,
      entityType: 'tasks',
      threadId: input.threadId,
      answerCommentId: input.answerCommentId
    });
  }

  private async request(
    auth: ProjectsMcpAuthContext,
    method: 'get' | 'post',
    path: string,
    data?: unknown,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    try {
      const response = await axios.request({
        method,
        url: `${this.getErpApiBase()}${path}`,
        data,
        params,
        timeout: 10000,
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          Accept: 'application/json',
          ...(data ? { 'Content-Type': 'application/json' } : {})
        }
      });
      return response.data;
    } catch (error) {
      const status = (error as AxiosError)?.response?.status;
      if (status && status >= 400 && status < 500) {
        throw new HttpException('ERP отклонил операцию с комментарием', status);
      }
      throw new BadGatewayException('Сервис комментариев ERP недоступен');
    }
  }

  private getErpApiBase(): string {
    const configured = this.configService
      .get<string>('erpApiUrl')
      ?.replace(/\/+$/, '');
    if (!configured) {
      throw new BadGatewayException('ERP_API_URL не настроен');
    }
    return configured.endsWith('/api') ? configured : `${configured}/api`;
  }
}
