import { Injectable, Logger } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WsGateway } from '../ws/ws.gateway';
import { ActivityHistoryQueryDto } from './dto/activity-history-query.dto';
import { ReadTaskActivityDto } from './dto/read-task-activity.dto';
import { ActivityEventPage } from './interfaces/activity-event.interface';
import {
  TaskActivityCounts,
  TaskActivityItem
} from './interfaces/task-activity.interface';

// Права собираются один раз для запроса, а не повторным сканированием участников каждой записи.
const ACCESSIBLE_PROJECTS = `WITH activity_accessible_projects AS (
  SELECT id FROM projects
  WHERE "deletedAt" IS NULL AND (
    created_by_id = :userId OR id IN (
      SELECT project_id FROM project_members WHERE user_id = :userId
    )
  )
)`;

// В том числе архивные задачи. Права проверяются заново, а не по старому получателю.
const FEED_FROM = `
  FROM activity_event_recipients r
  JOIN activity_events e ON e.id = r.event_id AND e.entity_type = 'task'
  JOIN tasks t ON t.id = e.entity_id::integer
  JOIN board_columns c ON c.id = t.column_id
  JOIN boards b ON b.id = c.board_id
  JOIN projects p ON p.id = e.project_id AND p."deletedAt" IS NULL
  JOIN projects destination ON destination.id = b.project_id AND destination."deletedAt" IS NULL
`;

const FEED_ACCESS = `
  r.user_id = :userId
  AND p.id IN (SELECT id FROM activity_accessible_projects)
  AND destination.id IN (SELECT id FROM activity_accessible_projects)
`;

@Injectable()
export class TaskActivityService {
  private readonly logger = new Logger(TaskActivityService.name);

  constructor(
    private sequelize: Sequelize,
    private ws: WsGateway
  ) {}

  /** Возвращает только адресованные текущему пользователю доступные события. */
  async getFeed(
    userId: number,
    query: ActivityHistoryQueryDto
  ): Promise<ActivityEventPage<TaskActivityItem>> {
    const limit = query.limit ?? 50;
    const items = await this.sequelize.query<TaskActivityItem>(
      `
      ${ACCESSIBLE_PROJECTS}
      SELECT e.id, e.project_id AS "projectId", e.entity_id AS "entityId",
        e.entity_type AS "entityType", e.action_type AS "actionType",
        e.actor_user_id AS "actorUserId", e.changes, e."createdAt", r.read_at AS "readAt",
        e.metadata || jsonb_build_object('activityBoardId', b.id) AS metadata,
        CASE WHEN actor.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', actor.id, 'login', actor.login, 'initial', actor.initial, 'image', actor.image
        ) END AS actor,
        t.id AS "taskId", destination.id AS "taskProjectId",
        COALESCE(e.metadata->>'activityTaskTitle', t.title) AS "taskTitle",
        COALESCE((e.metadata->>'activityTaskNumber')::integer, t.task_number) AS "taskNumber",
        COALESCE(e.metadata->>'activityProjectPrefix', p.prefix) AS "projectPrefix"
      ${FEED_FROM}
      LEFT JOIN users actor ON actor.id = e.actor_user_id
      WHERE ${FEED_ACCESS} ${query.beforeId ? 'AND e.id < :beforeId' : ''}
      ORDER BY e.id DESC LIMIT :limit
    `,
      {
        type: QueryTypes.SELECT,
        replacements: { userId, beforeId: query.beforeId, limit: limit + 1 }
      }
    );
    const hasNext = items.length > limit;
    const page = items.slice(0, limit);

    return {
      items: page,
      nextCursor: hasNext ? page[page.length - 1].id : null
    };
  }

  /** Считает непрочитанное одним запросом, независимо от количества проектов и задач. */
  async getCounts(userId: number): Promise<TaskActivityCounts> {
    const rows = await this.sequelize.query<{
      projectId: number;
      count: string;
    }>(
      `
      ${ACCESSIBLE_PROJECTS}
      SELECT e.project_id AS "projectId", count(*) AS count
      ${FEED_FROM}
      WHERE ${FEED_ACCESS} AND r.read_at IS NULL
      GROUP BY e.project_id
    `,
      { type: QueryTypes.SELECT, replacements: { userId } }
    );
    const projects: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      projects[String(row.projectId)] = Number(row.count);
      total += Number(row.count);
    }

    return { total, projects };
  }

  /** Отмечает только события открытой задачи до показанного снимка, не более новые. */
  async markRead(userId: number, dto: ReadTaskActivityDto): Promise<void> {
    await this.sequelize.query(
      `
      ${ACCESSIBLE_PROJECTS}
      UPDATE activity_event_recipients recipient SET read_at = CURRENT_TIMESTAMP
      WHERE recipient.user_id = :userId AND recipient.read_at IS NULL
        AND recipient.event_id IN (
          SELECT e.id ${FEED_FROM}
          WHERE ${FEED_ACCESS} AND t.id = :taskId AND e.id <= :throughEventId
        )
    `,
      {
        replacements: {
          userId,
          taskId: dto.taskId,
          throughEventId: dto.throughEventId
        }
      }
    );
    try {
      this.ws.emitTaskActivityChanged([userId]);
    } catch {
      this.logger.warn(
        'Task activity read-state realtime delivery unavailable'
      );
    }
  }
}
