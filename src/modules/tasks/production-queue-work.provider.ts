import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Optional
} from '@nestjs/common';
import {
  AmqpConnection,
  RabbitRPC,
  RabbitSubscribe
} from '@golevelup/nestjs-rabbitmq';
import { Sequelize } from 'sequelize-typescript';
import { Transaction } from 'sequelize';
import { Public } from '../auth/public.decorator';
import { TasksService } from './tasks.service';
import type {
  ProductionQueueWorkRequest,
  ProductionQueueWorkResponse,
  ProductionQueueDates
} from './interfaces/production-queue-work.interface';

/** Норма и права остаются у Board; персональные даты рассчитывает ERP. */
@Injectable()
export class ProductionQueueWorkProvider
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ProductionQueueWorkProvider.name);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private readonly scheduledTransactions = new WeakSet<Transaction>();
  private readonly planningModels = new Set([
    'Task',
    'TaskAssignee',
    'BoardColumn',
    'Board',
    'Project',
    'ProjectMember'
  ]);

  constructor(
    private readonly tasks: TasksService,
    private readonly sequelize: Sequelize,
    @Optional() private readonly connection: AmqpConnection
  ) {}

  /** RPC доступен только через доверенный брокер; HTTP-маршрута без авторизации нет. */
  @Public()
  @RabbitRPC({
    exchange: 'erp',
    routingKey: 'board.production-planning.read',
    queue: 'board.production-planning.read'
  })
  async read(
    request: ProductionQueueWorkRequest
  ): Promise<ProductionQueueWorkResponse> {
    if (
      !Number.isSafeInteger(request?.resourceId) ||
      request.resourceId <= 0 ||
      !Array.isArray(request.taskIds) ||
      !request.taskIds.length ||
      request.taskIds.length > 10000 ||
      request.taskIds.some(id => !Number.isSafeInteger(id) || id <= 0) ||
      (request.actorErpId !== undefined &&
        (!Number.isSafeInteger(request.actorErpId) || request.actorErpId <= 0))
    ) {
      return { error: 'Некорректный запрос работ исполнителя', status: 400 };
    }
    try {
      return {
        items: await this.tasks.getProductionQueueWork(
          request.resourceId,
          request.taskIds,
          request.actorErpId
        )
      };
    } catch (error) {
      return { error: error.message, status: error.status || 503 };
    }
  }

  /** Только зафиксированные изменения могут перестраивать внешнюю очередь. */
  @Public()
  @RabbitSubscribe({
    exchange: 'erp',
    routingKey: 'board.production-planning.dates',
    queue: 'board.production-planning.dates'
  })
  async applyDates(projection: ProductionQueueDates): Promise<void> {
    if (
      !Number.isSafeInteger(projection?.resourceId) ||
      projection.resourceId <= 0 ||
      typeof projection.version !== 'string' ||
      !/^\d{1,18}$/.test(projection.version) ||
      !Array.isArray(projection.tasks) ||
      projection.tasks.some(
        task =>
          !Number.isSafeInteger(task.taskId) ||
          task.taskId <= 0 ||
          (task.startTime !== null &&
            !Number.isFinite(new Date(task.startTime).getTime()))
      )
    ) {
      throw new Error('Некорректная проекция персональных дат ERP');
    }
    await this.sequelize.transaction(async transaction => {
      // UPSERT сериализует сообщения одного исполнителя; запоздавшая версия не меняет даты.
      const [updated] = await this.sequelize.query(
        `INSERT INTO production_queue_versions (resource_id, version) VALUES (:resourceId, :version)
         ON CONFLICT (resource_id) DO UPDATE SET version = EXCLUDED.version
         WHERE production_queue_versions.version < EXCLUDED.version RETURNING resource_id`,
        {
          replacements: {
            resourceId: projection.resourceId,
            version: projection.version
          },
          transaction
        }
      );
      if (!updated.length) return;
      // Прямой UPDATE проекции не запускает invalidation hooks и не образует цикл ERP → Board → ERP.
      await this.sequelize.query(
        `UPDATE task_assignees assignment SET production_start_date = dates.start_time
         FROM users executor LEFT JOIN jsonb_to_recordset(CAST(:tasks AS jsonb)) AS dates(task_id integer, start_time timestamptz) ON true
         WHERE assignment.user_id = executor.id AND executor.erp_id = :resourceId
         AND assignment.task_id = dates.task_id`,
        {
          replacements: {
            resourceId: String(projection.resourceId),
            tasks: JSON.stringify(
              projection.tasks.map(task => ({
                task_id: task.taskId,
                start_time: task.startTime
              }))
            )
          },
          transaction
        }
      );
      await this.sequelize.query(
        `UPDATE task_assignees assignment SET production_start_date = NULL FROM users executor
         WHERE assignment.user_id = executor.id AND executor.erp_id = :resourceId
         AND NOT (assignment.task_id = ANY(CAST(:taskIds AS integer[])))`,
        {
          replacements: {
            resourceId: String(projection.resourceId),
            taskIds: `{${projection.tasks.map(task => task.taskId).join(',')}}`
          },
          transaction
        }
      );
    });
  }

  /** Только зафиксированные изменения могут перестраивать внешнюю очередь. */
  private schedule(transaction?: Transaction): void {
    if (!this.connection) return;
    // Модельные hooks уже объединяются одним debounce-уведомлением после commit.
    // Не регистрируем одинаковый callback для каждой изменённой строки транзакции.
    if (transaction) {
      if (this.scheduledTransactions.has(transaction)) return;
      this.scheduledTransactions.add(transaction);
    }
    const notify = (): void => {
      clearTimeout(this.timer);
      this.timer = setTimeout((): void => {
        void this.connection
          .publish(
            'erp',
            'board.production-planning.changed',
            {},
            { persistent: true }
          )
          .catch((error: Error): void => {
            this.logger.error(
              'Не удалось уведомить ERP об изменении задач',
              error.stack
            );
            if (!this.stopped)
              this.timer = setTimeout((): void => this.schedule(), 10000);
          });
      }, 100);
    };
    if (transaction) transaction.afterCommit(notify);
    else notify();
  }

  /** Hooks включают массовые назначения, архивирование и смену статуса колонок. */
  onModuleInit(): void {
    this.schedule();
    this.sequelize.addHook(
      'afterSave',
      'productionQueue',
      (instance, options): void => {
        if (this.planningModels.has(instance.constructor.name))
          this.schedule(options.transaction);
      }
    );
    this.sequelize.addHook(
      'afterDestroy',
      'productionQueue',
      (instance, options): void => {
        if (this.planningModels.has(instance.constructor.name))
          this.schedule(options.transaction);
      }
    );
    this.sequelize.addHook(
      'afterBulkCreate',
      'productionQueue',
      (instances, options): void => {
        if (
          instances.some(instance =>
            this.planningModels.has(instance.constructor.name)
          )
        )
          this.schedule(options.transaction);
      }
    );
    this.sequelize.addHook(
      'afterBulkUpdate',
      'productionQueue',
      (options): void => {
        if (
          'model' in options &&
          typeof options.model === 'function' &&
          this.planningModels.has(options.model.name)
        )
          this.schedule(options.transaction);
      }
    );
    this.sequelize.addHook(
      'afterBulkDestroy',
      'productionQueue',
      (options): void => {
        if (
          'model' in options &&
          typeof options.model === 'function' &&
          this.planningModels.has(options.model.name)
        )
          this.schedule(options.transaction);
      }
    );
  }

  /** Повторный запуск модуля не оставляет лишние подписки. */
  onModuleDestroy(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    for (const hook of [
      'afterSave',
      'afterDestroy',
      'afterBulkCreate',
      'afterBulkUpdate',
      'afterBulkDestroy'
    ] as const) {
      this.sequelize.removeHook(hook, 'productionQueue');
    }
  }
}
