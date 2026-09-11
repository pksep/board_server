import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Server, ServerOptions } from 'socket.io';

/** Socket.IO не ожидает некоторые команды отписки; их отказы всё равно должны быть обработаны. */
class BoardRedisClient extends Redis {
  sendCommand(
    ...args: Parameters<Redis['sendCommand']>
  ): ReturnType<Redis['sendCommand']> {
    const result = super.sendCommand(...args);
    // Сохраняем исходный rejected Promise для ожидающих вызовов, одновременно исключая unhandled rejection SDK.
    void args[0].promise.catch(() =>
      this.emit('error', new Error('Команда транспорта доски не выполнена'))
    );
    return result;
  }
}

/** Доставляет изменения доски пользователям всех экземпляров приложения. */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private adapterFactory: ReturnType<typeof createAdapter> | null = null;
  private socketServer: Server | null = null;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  /** Подключает общий транспорт до открытия HTTP/WebSocket-порта. */
  async connectToRedis(url: string, key: string): Promise<void> {
    this.publisher = new BoardRedisClient(url, {
      lazyConnect: true,
      enableOfflineQueue: false
    });
    this.subscriber = new BoardRedisClient(url, {
      lazyConnect: true,
      enableOfflineQueue: false
    });
    for (const client of [this.publisher, this.subscriber]) {
      // URL и детали подключения могут содержать секреты и не попадают в лог.
      client.on('error', () =>
        this.logger.warn('Транспорт обновлений доски временно недоступен')
      );
    }
    this.subscriber.on('ready', () => {
      // Pub/Sub не хранит пропущенные события: после его восстановления клиенты перечитывают снимок.
      this.socketServer?.of('/board').local.emit('board:resync');
    });
    try {
      await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
      this.adapterFactory = createAdapter(this.publisher, this.subscriber, {
        key
      });
    } catch (error) {
      this.publisher.disconnect();
      this.subscriber.disconnect();
      throw new Error('Не удалось подключить транспорт обновлений доски');
    }
  }

  /** Подключает стандартный Socket.IO adapter без изменения комнат и проверки прав. */
  createIOServer(port: number, options?: ServerOptions): Server {
    if (!this.adapterFactory)
      throw new Error('Транспорт обновлений доски не инициализирован');
    const server = super.createIOServer(port, options) as Server;
    server.adapter(this.adapterFactory);
    this.socketServer = server;
    return server;
  }

  /** Закрывает обе Redis-подписки вместе с приложением, включая watch-перезапуск. */
  async close(server: Parameters<IoAdapter['close']>[0]): Promise<void> {
    try {
      await super.close(server);
    } finally {
      this.publisher?.disconnect();
      this.subscriber?.disconnect();
      this.socketServer = null;
    }
  }
}
