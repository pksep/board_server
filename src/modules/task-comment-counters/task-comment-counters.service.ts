import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { TasksService } from '../tasks/tasks.service';
import { PersonalTaskQueryDto } from '../tasks/dto/personal-task-query.dto';
import type {
  CounterRequestSession,
  ErpCommentCounter,
  TaskCommentCounters
} from './interfaces/task-comment-counter.interface';

@Injectable()
export class TaskCommentCountersService {
  constructor(
    private readonly tasks: TasksService,
    private readonly config: ConfigService
  ) {}

  /** Общая сумма по серверной области задач, независимо от клиентской пагинации. */
  async personal(
    userId: number,
    query: PersonalTaskQueryDto,
    session: CounterRequestSession
  ): Promise<TaskCommentCounters> {
    const ids = await this.tasks.getPersonalTaskIds(userId, query);

    return this.readCounters(ids, session);
  }

  /** Только успешное открытие доступной задачи снимает её непрочитанные комментарии. */
  async markTaskRead(
    taskId: number,
    userId: number,
    session: CounterRequestSession
  ): Promise<TaskCommentCounters> {
    await this.tasks.assertCanReadTaskComments(taskId, userId);

    return this.readCounters([taskId], session, true);
  }

  /** ERP определяет читателя по исходной проверенной сессии, а не по Board ID. */
  private async readCounters(
    ids: number[],
    session: CounterRequestSession,
    markRead = false
  ): Promise<TaskCommentCounters> {
    const cookie = session.cookies?.access_token;
    const authorization = session.headers.authorization;
    if (typeof cookie !== 'string' && !authorization)
      throw new UnauthorizedException();
    const base = this.config.get<string>('erpApiUrl')?.replace(/\/+$/, '');
    const key = process.env.COMMENTS_COUNTERS_KEY;
    if (!base || !key || key.length < 32)
      throw new ServiceUnavailableException(
        'Счётчики комментариев не настроены'
      );
    const result: TaskCommentCounters = {
      total: 0,
      unread: 0,
      tasks: [],
      taskIds: ids
    };

    try {
      for (let offset = 0; offset < ids.length; offset += 500) {
        const batch = ids.slice(offset, offset + 500);
        const requested = new Set(batch);
        const response = await axios.post<ErpCommentCounter[]>(
          `${base.endsWith('/api') ? base : `${base}/api`}/comments/counters`,
          { entityType: 'tasks', entityIds: batch, markRead },
          {
            timeout: 15000,
            headers: {
              'X-Comments-Counters-Key': key,
              compress: 'no-compress',
              ...(session.headers.origin
                ? { Origin: session.headers.origin }
                : {}),
              ...(session.headers.referer
                ? { Referer: session.headers.referer }
                : {}),
              ...(typeof cookie === 'string'
                ? { Cookie: `access_token=${encodeURIComponent(cookie)}` }
                : { Authorization: authorization })
            }
          }
        );
        if (!Array.isArray(response.data))
          throw new Error('Invalid comment counters');
        const seen = new Set<number>();

        for (const item of response.data) {
          if (
            !requested.has(item.entityId) ||
            seen.has(item.entityId) ||
            !Number.isSafeInteger(item.total) ||
            item.total < 0 ||
            !Number.isSafeInteger(item.unread) ||
            item.unread < 0 ||
            item.unread > item.total
          )
            throw new Error('Invalid comment counter');
          seen.add(item.entityId);
          result.total += item.total;
          result.unread += item.unread;
          if (item.total || markRead)
            result.tasks.push({
              taskId: item.entityId,
              total: item.total,
              unread: item.unread
            });
        }
        if (seen.size !== batch.length)
          throw new Error('Incomplete comment counters');
      }

      return result;
    } catch (error) {
      // Сбой внутреннего ключа не должен разлогинивать действительную ERP-сессию.
      throw new ServiceUnavailableException(
        'Не удалось получить счётчики комментариев'
      );
    }
  }
}
