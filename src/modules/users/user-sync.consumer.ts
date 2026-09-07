import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { User } from './model/users.model';
import { Sequelize } from 'sequelize-typescript';
import { UsersService } from './users.service';
import { Public } from '../auth/public.decorator';

const { ERP, wildcard } = require('@pksep/contracts');

type UserCreateEvent = any;
type EntityChangeEvent = any;
type EntityDeleteEvent = any;
type EntityBanEvent = any;
type UserPayload = any;
type SyncableUserField =
  | 'initial'
  | 'login'
  | 'serviceNumber'
  | 'image'
  | 'ban'
  | 'role';

/**
 * Маппинг имён полей из ERP → Board User model.
 * ERP entity events содержат changeFields[].fieldName — названия полей в ERP.
 */
const ERP_FIELD_MAP: Record<string, string> = {
  initials: 'initial',
  initial: 'initial',
  nickname: 'login',
  login: 'login',
  tabel: 'serviceNumber',
  serviceNumber: 'serviceNumber',
  avatarUrl: 'image',
  image: 'image',
  ban: 'ban',
  role: 'role'
};

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

@Injectable()
export class UserSyncConsumer {
  private readonly logger = new Logger(UserSyncConsumer.name);

  constructor(
    @InjectModel(User) private readonly userRepository: typeof User,
    private readonly sequelize: Sequelize,
    private readonly usersService: UsersService
  ) {}

  private buildUserData(
    payload: UserPayload
  ): Partial<Record<SyncableUserField, string | boolean | null>> {
    const initial =
      getString(payload.initials) ||
      getString(payload.initial) ||
      getString(payload.nickname);
    const login = getString(payload.nickname) || getString(payload.login);
    const serviceNumber =
      getString(payload.ex?.tabel) ||
      getString(payload.tabel) ||
      getString(payload.serviceNumber) ||
      getString(payload.id);
    const image = getString(payload.avatarUrl) || getString(payload.image);
    const ban = getBoolean(payload.ban) ?? getBoolean(payload.banned);
    const role = getString(payload.role);

    return {
      ...(initial ? { initial } : {}),
      ...(login ? { login } : {}),
      ...(serviceNumber ? { serviceNumber } : {}),
      ...(image !== null ? { image } : {}),
      ...(ban !== null ? { ban } : {}),
      ...(role ? { role } : {})
    };
  }

  /**
   * Подписка на все user.* события из exchange ERP.
   * Routing key определяет тип события.
   */
  // Событие приходит по авторизованному соединению RabbitMQ, без HTTP-cookie.
  @Public()
  @RabbitSubscribe({
    exchange: ERP,
    routingKey: wildcard('user'), // 'user.*'
    queue: process.env.BOARD_USER_EVENTS_QUEUE || 'board-service.user-events'
  })
  async handleUserEvent(
    event:
      | UserCreateEvent
      | EntityChangeEvent
      | EntityDeleteEvent
      | EntityBanEvent,
    amqpMsg: { fields: { routingKey: string } }
  ): Promise<void> {
    // ERP публикует NestJS-конверт { pattern, data }; старые события приходят напрямую.
    const routingKey = amqpMsg?.fields?.routingKey || event?.pattern || '';
    event = event?.data ?? event;
    const eventType = routingKey.split('.').pop(); // create | change | delete | ban

    this.logger.log(`Received user event: ${routingKey}`);

    try {
      switch (eventType) {
        case 'create':
          await this.handleCreate(event as UserCreateEvent);
          break;
        case 'change':
          await this.handleChange(event as EntityChangeEvent);
          break;
        case 'delete':
          await this.handleDelete(event as EntityDeleteEvent);
          break;
        case 'ban':
          await this.handleBan(event as EntityBanEvent);
          break;
        default:
          this.logger.warn(`Unknown user event type: ${eventType}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to process user event ${routingKey}: ${message}`,
        stack
      );
      throw error;
    }
  }

  /**
   * user.create — создать пользователя в локальной БД
   */
  private async handleCreate(event: UserCreateEvent): Promise<void> {
    const payload = event.entity as UserPayload;
    const erpId = String(payload.id);
    const userData = this.buildUserData(payload);

    // Проверяем: может уже есть
    const existing = await this.userRepository.findOne({
      where: { erpId }
    });

    if (existing) {
      this.logger.log(
        `User with erpId=${erpId} already exists, skipping create`
      );
      return;
    }

    await this.userRepository.create({
      erpId,
      initial: userData.initial || 'User',
      login: userData.login || `user-${erpId}`,
      serviceNumber: userData.serviceNumber || erpId,
      image: userData.image ?? null,
      ban: typeof userData.ban === 'boolean' ? userData.ban : false,
      role: userData.role || '-'
    } as any);

    this.logger.log(`Created user from ERP: erpId=${erpId}`);
  }

  /**
   * user.change — обновить изменённые поля
   */
  private async handleChange(event: EntityChangeEvent): Promise<void> {
    const { id } = event.entity;
    const changeFields =
      event.entity.changedFields ?? event.entity.changeFields ?? [];
    const erpId = String(id);

    const user = await this.userRepository.findOne({ where: { erpId } });
    if (!user) {
      this.logger.warn(`User with erpId=${erpId} not found for change event`);
      return;
    }

    let changed = false;
    for (const field of changeFields) {
      const boardField = ERP_FIELD_MAP[field.fieldName] as
        | SyncableUserField
        | undefined;
      if (!boardField) {
        continue;
      }

      let nextValue: string | boolean | null = field.currentValue;

      if (boardField === 'ban') {
        nextValue = getBoolean(field.currentValue);
      } else {
        nextValue = getString(field.currentValue);
      }

      if (nextValue === null) {
        continue;
      }

      if ((user as any)[boardField] !== nextValue) {
        (user as any)[boardField] = nextValue;
        changed = true;
      }
    }

    if (changed) {
      await this.sequelize.transaction(async transaction => {
        await this.usersService.saveUserAvailability(user, transaction);
      });
      this.logger.log(
        `Updated user erpId=${erpId}: ${changeFields.map(f => f.fieldName).join(', ')}`
      );
    }
  }

  /**
   * user.delete — soft delete пользователя
   */
  private async handleDelete(event: EntityDeleteEvent): Promise<void> {
    const erpId = String(event.entity.id);

    const user = await this.userRepository.findOne({ where: { erpId } });
    if (!user) {
      this.logger.warn(`User with erpId=${erpId} not found for delete event`);
      return;
    }

    user.ban = true;
    await this.sequelize.transaction(async transaction => {
      await this.usersService.saveUserAvailability(user, transaction);
    });
    this.logger.log(`Soft-deleted (banned) user erpId=${erpId}`);
  }

  /**
   * user.ban — переключить блокировку
   */
  private async handleBan(event: EntityBanEvent): Promise<void> {
    const erpId = String(event.entity.id);

    const user = await this.userRepository.findOne({ where: { erpId } });
    if (!user) {
      this.logger.warn(`User with erpId=${erpId} not found for ban event`);
      return;
    }

    const banned =
      getBoolean(event.entity.banned) ?? getBoolean(event.entity.ban);
    if (banned === null)
      throw new Error('User ban event must contain a boolean state');
    user.ban = banned;
    await this.sequelize.transaction(async transaction => {
      await this.usersService.saveUserAvailability(user, transaction);
    });
    this.logger.log(`User erpId=${erpId} ban=${event.entity.banned}`);
  }
}
