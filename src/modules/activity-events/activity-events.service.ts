import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
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
  constructor(
    @InjectModel(ActivityEvent)
    private activityEventRepository: typeof ActivityEvent
  ) {}

  create(
    event: CreateActivityEvent,
    options: ActivityEventWriteOptions
  ): Promise<ActivityEvent> {
    return this.activityEventRepository.create(
      {
        ...event,
        actorUserId: event.actorUserId ?? null,
        changes: event.changes ?? [],
        metadata: event.metadata ?? {}
      } as any,
      options
    );
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
