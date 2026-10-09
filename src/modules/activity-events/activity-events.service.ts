import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes } from 'sequelize';
import { ActivityEntityType } from './activity-events.constants';
import { WsGateway } from '../ws/ws.gateway';
import { User } from '../users/model/users.model';
import {
  ActivityChange,
  ActivityEventPage,
  ActivityEventWriteOptions,
  CreateActivityEvent,
  FindEntityActivity
} from './interfaces/activity-event.interface';
import { ActivityEvent } from './model/activity-event.model';

@Injectable()
export class ActivityEventsService {
  private readonly logger = new Logger(ActivityEventsService.name);

  constructor(
    @InjectModel(ActivityEvent)
    private activityEventRepository: typeof ActivityEvent,
    private ws: WsGateway
  ) {}

  /** Фиксирует событие и исполнителей атомарно с изменением задачи. */
  async create(
    event: CreateActivityEvent,
    options: ActivityEventWriteOptions
  ): Promise<ActivityEvent> {
    const activity = await this.activityEventRepository.create(
      {
        ...event,
        actorUserId: event.actorUserId ?? null,
        changes: event.changes ?? [],
        metadata: event.metadata ?? {}
      } as any,
      options
    );

    if (event.entityType !== ActivityEntityType.Task) return activity;

    const assignments = event.changes?.find(
      change => change.field === 'assigneeIds'
    );
    const additionalIds = [
      ...new Set(
        [
          ...(Array.isArray(assignments?.before) ? assignments.before : []),
          ...(Array.isArray(assignments?.after) ? assignments.after : [])
        ].filter((id): id is number => Number.isSafeInteger(id) && id > 0)
      )
    ];
    const sequelize = this.activityEventRepository.sequelize;
    if (!sequelize) throw new Error('Activity repository is not initialized');

    // Бывший исполнитель получает передачу задачи, но не её последующие изменения.
    const recipients = await sequelize.query<{ userId: number }>(
      `
      INSERT INTO activity_event_recipients (event_id, user_id)
      SELECT :eventId, user_id FROM (
        SELECT user_id FROM task_assignees WHERE task_id = :taskId
        UNION
        SELECT id AS user_id FROM users WHERE id IN (:additionalIds)
      ) assignments
      ON CONFLICT DO NOTHING
      RETURNING user_id AS "userId"
    `,
      {
        type: QueryTypes.SELECT,
        transaction: options.transaction,
        replacements: {
          eventId: activity.id,
          taskId: Number(event.entityId),
          additionalIds: additionalIds.length ? additionalIds : [-1]
        }
      }
    );

    // Название и номер в ленте относятся к моменту события, не к будущему переименованию.
    await sequelize.query(
      `
      UPDATE activity_events e
      SET metadata = e.metadata || jsonb_build_object(
        'activityTaskTitle', t.title, 'activityTaskNumber', COALESCE(:taskNumber::integer, t.task_number),
        'activityProjectPrefix', p.prefix
      )
      FROM tasks t, projects p
      WHERE e.id = :eventId AND t.id = :taskId AND p.id = e.project_id
    `,
      {
        transaction: options.transaction,
        replacements: {
          eventId: activity.id,
          taskId: Number(event.entityId),
          taskNumber:
            event.metadata?.direction === 'out'
              ? (event.changes?.find(change => change.field === 'taskNumber')
                  ?.before ?? null)
              : null
        }
      }
    );

    if (recipients.length) {
      options.transaction.afterCommit(() => {
        try {
          this.ws.emitTaskActivityChanged(
            recipients.map(recipient => recipient.userId)
          );
        } catch {
          // Недоступный realtime не превращает уже сохранённую правку в ошибку сохранения.
          this.logger.warn('Task activity realtime delivery unavailable');
        }
      });
    }

    return activity;
  }

  buildChanges(
    fields: Record<string, { before: unknown; after: unknown }>
  ): ActivityChange[] {
    return Object.entries(fields)
      .filter(([, values]) => !this.valuesEqual(values.before, values.after))
      .map(([field, values]) => ({
        field,
        before: values.before,
        after: values.after
      }));
  }

  async findByEntity({
    projectId,
    entityType,
    entityId,
    limit = 50,
    beforeId
  }: FindEntityActivity): Promise<ActivityEventPage<ActivityEvent>> {
    const pageSize = Math.min(Math.max(limit, 1), 100);
    const items = await this.activityEventRepository.findAll({
      where: {
        projectId,
        entityType,
        entityId,
        ...(beforeId ? { id: { [Op.lt]: beforeId } } : {})
      },
      include: [
        {
          model: User,
          as: 'actor',
          attributes: ['id', 'login', 'initial', 'image'],
          required: false
        }
      ],
      order: [['id', 'DESC']],
      limit: pageSize + 1
    });

    const hasNextPage = items.length > pageSize;
    const pageItems = hasNextPage ? items.slice(0, pageSize) : items;

    return {
      items: pageItems,
      nextCursor: hasNextPage
        ? Number(pageItems[pageItems.length - 1].id)
        : null
    };
  }

  private valuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    return JSON.stringify(left) === JSON.stringify(right);
  }
}
