import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import {
  MessageHandlerErrorBehavior,
  RabbitSubscribe
} from '@golevelup/nestjs-rabbitmq';
import { User } from './model/users.model';
import { Sequelize } from 'sequelize-typescript';
import { Op, UniqueConstraintError } from 'sequelize';
import { UsersService } from './users.service';
import { Public } from '../auth/public.decorator';
import type {
  IBoardUserSyncData,
  IErpUserCreatePayload
} from './interfaces/erp-user-create-event.interface';

import { ERP, wildcard } from '@pksep/contracts';
import type {
  IErpUserEvent,
  IErpUserChangeEvent,
  SyncableUserField
} from './interfaces/erp-user-event.interface';
import { isEventRecord, normalizeErpUserEvent } from './utils/erp-user-event';

/**
 * Маппинг имён полей из ERP → Board User model.
 * ERP entity events содержат changeFields[].fieldName — названия полей в ERP.
 */
const ERP_FIELD_MAP: Record<string, SyncableUserField> = {
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

  private buildUserData(payload: IErpUserCreatePayload): IBoardUserSyncData {
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
    queue: process.env.BOARD_USER_EVENTS_QUEUE || 'board-service.user-events',
    // Ошибочное событие не должно бесконечно блокировать очередь. Для
    // сохранения таких сообщений на очередь нужно назначить DLX policy.
    errorBehavior: MessageHandlerErrorBehavior.NACK
  })
  async handleUserEvent(
    event: unknown,
    amqpMsg: { fields: { routingKey: string } }
  ): Promise<void> {
    // ERP публикует NestJS-конверт { pattern, data }; старые события приходят напрямую.
    const envelope = isEventRecord(event) ? event : {};
    const routingKey =
      amqpMsg?.fields?.routingKey ||
      (typeof envelope.pattern === 'string' ? envelope.pattern : '');
    event = envelope.data ?? event;
    const eventType = routingKey.split('.').pop(); // create | change | delete | ban

    this.logger.log(`Received user event: ${routingKey}`);

    try {
      if (!['create', 'change', 'delete', 'ban'].includes(eventType)) {
        this.logger.warn(`Unknown user event type: ${eventType}`);
        return;
      }
      const normalized = normalizeErpUserEvent(event, eventType);
      switch (normalized.type) {
        case 'create':
          await this.synchronizeUser(normalized.entity);
          break;
        case 'change':
          await this.handleChange(normalized);
          break;
        case 'delete':
          await this.handleDelete(normalized);
          break;
        case 'ban':
          await this.handleBan(normalized);
          break;
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

  /** Сопоставляет ERP-пользователя; сверка справочника дополняет только отсутствующие записи. */
  async synchronizeUser(
    payload: IErpUserCreatePayload,
    onlyMissing = false
  ): Promise<void> {
    if (
      !payload ||
      (typeof payload.id !== 'number' && typeof payload.id !== 'string') ||
      !String(payload.id).trim()
    ) {
      throw new Error('User create event must contain an ERP user id');
    }
    const erpId = String(payload.id).trim();
    const userData = this.buildUserData(payload);
    const serviceNumber = userData.serviceNumber || erpId;

    // SELECT + INSERT могут столкнуться при параллельной доставке. Повторно
    // читаем уже созданную строку в новой транзакции, но не зацикливаемся.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.sequelize.transaction(async transaction => {
          const candidates = await this.userRepository.findAll({
            where: {
              [Op.or]: [{ erpId }, { serviceNumber }]
            },
            order: [['id', 'ASC']],
            limit: 2,
            lock: transaction.LOCK.UPDATE,
            transaction
          });
          const byErpId = candidates.find(user => user.erpId === erpId);
          const byServiceNumber = candidates.find(
            user => user.serviceNumber === serviceNumber
          );

          if (byErpId && byServiceNumber && byErpId.id !== byServiceNumber.id) {
            throw new Error(
              `Conflicting Board users for erpId=${erpId} and serviceNumber=${serviceNumber}`
            );
          }

          const user = byErpId || byServiceNumber;
          if (!user) {
            await this.userRepository.create(
              {
                erpId,
                initial: userData.initial || 'User',
                login: userData.login || `user-${erpId}`,
                serviceNumber,
                image: userData.image ?? null,
                ban: userData.ban ?? false,
                role: userData.role || '-'
              } as User,
              { transaction }
            );
            this.logger.log(`Created user from ERP: erpId=${erpId}`);
            return;
          }

          // Снимок справочника не отменяет более свежие события блокировки или назначения.
          if (onlyMissing) return;

          const updates = { erpId, ...userData, serviceNumber };
          const changed = (
            Object.keys(updates) as (keyof typeof updates)[]
          ).some(key => user[key] !== updates[key]);
          if (!changed) return;

          const wasBanned = user.ban;
          if (user.erpId && user.erpId !== erpId) {
            this.logger.warn(
              `Relinking Board user id=${user.id} from erpId=${user.erpId} to ${erpId} by serviceNumber=${serviceNumber}`
            );
          }
          Object.assign(user, updates);
          if (user.ban || wasBanned !== user.ban) {
            await this.usersService.saveUserAvailability(user, transaction);
          } else {
            await user.save({ transaction });
          }
          this.logger.log(`Updated user from ERP: erpId=${erpId}`);
        });
        return;
      } catch (error) {
        if (!(error instanceof UniqueConstraintError) || attempt === 1) {
          throw error;
        }
        this.logger.warn(
          `Concurrent user.create conflict for erpId=${erpId}; retrying once`
        );
      }
    }
  }

  /**
   * user.change — обновить изменённые поля
   */
  private async handleChange(event: IErpUserChangeEvent): Promise<void> {
    const { id } = event.entity;
    const changeFields = event.entity.changeFields;
    const erpId = String(id);

    const user = await this.userRepository.findOne({ where: { erpId } });
    if (!user) {
      this.logger.warn(`User with erpId=${erpId} not found for change event`);
      return;
    }

    let changed = false;
    for (const field of changeFields) {
      const boardField = ERP_FIELD_MAP[field.fieldName];
      if (!boardField) {
        continue;
      }

      let nextValue: string | boolean | null;

      if (boardField === 'ban') {
        nextValue = getBoolean(field.currentValue);
      } else {
        nextValue = getString(field.currentValue);
      }

      if (nextValue === null) {
        continue;
      }

      if (boardField === 'ban' && typeof nextValue === 'boolean') {
        if (user.ban !== nextValue) {
          user.ban = nextValue;
          changed = true;
        }
      } else if (boardField !== 'ban' && typeof nextValue === 'string') {
        if (user[boardField] !== nextValue) {
          user[boardField] = nextValue;
          changed = true;
        }
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
  private async handleDelete(
    event: Extract<IErpUserEvent, { type: 'delete' }>
  ): Promise<void> {
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
  private async handleBan(
    event: Extract<IErpUserEvent, { type: 'ban' }>
  ): Promise<void> {
    const erpId = String(event.entity.id);

    const user = await this.userRepository.findOne({ where: { erpId } });
    if (!user) {
      this.logger.warn(`User with erpId=${erpId} not found for ban event`);
      return;
    }

    const banned = event.entity.banned;
    if (banned === null)
      throw new Error('User ban event must contain a boolean state');
    user.ban = banned;
    await this.sequelize.transaction(async transaction => {
      await this.usersService.saveUserAvailability(user, transaction);
    });
    this.logger.log(`User erpId=${erpId} ban=${event.entity.banned}`);
  }
}
