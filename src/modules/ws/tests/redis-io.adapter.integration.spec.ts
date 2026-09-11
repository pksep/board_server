import { createServer, Server as HttpServer } from 'http';
import { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import { Server } from 'socket.io';
import Redis from 'ioredis';
import { RedisIoAdapter } from '../redis-io.adapter';

// Запускается с отдельным тестовым Redis; уникальный Pub/Sub-префикс не затрагивает рабочие комнаты.
const describeWithRedis = process.env.REDIS_TEST_URL ? describe : describe.skip;
describeWithRedis('RedisIoAdapter cross-instance delivery', () => {
  const instances: {
    http: HttpServer;
    adapter: RedisIoAdapter;
    server: Server;
  }[] = [];
  const clients: Socket[] = [];
  const key = `erp469-test:${process.pid}:${Date.now()}`;

  /** Поднимает независимый сервер с реальным адаптером и подписывает клиента на тестовую комнату. */
  async function instance(channelKey: string, room = 'board:31') {
    const http = createServer();
    const adapter = new RedisIoAdapter(http as any);
    await adapter.connectToRedis(process.env.REDIS_TEST_URL!, channelKey);
    const server = adapter.createIOServer(0);
    instances.push({ http, adapter, server });
    server.of('/board').on('connection', async socket => {
      await socket.join(room);
      socket.emit('ready');
    });
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
    const client = io(
      `http://127.0.0.1:${(http.address() as AddressInfo).port}/board`,
      {
        transports: ['websocket'],
        reconnection: false
      }
    );
    clients.push(client);
    await event(client, 'ready');
    return { adapter, server, client };
  }

  /** Ожидает фактическую доставку с ограниченным временем вместо проверки вызова mock. */
  function event(socket: Socket, name: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off(name, receive);
        reject(new Error(`Missing ${name}`));
      }, 5000);
      const receive = (data: unknown) => {
        clearTimeout(timer);
        resolve(data);
      };
      socket.once(name, receive);
    });
  }

  afterEach(async () => {
    clients.splice(0).forEach(client => client.disconnect());
    await Promise.all(
      instances
        .splice(0)
        .map(({ adapter, server }) => adapter.close(server as any))
    );
  });

  it('доставляет событие другому процессу, сохраняя границы комнаты и окружения', async () => {
    const source = await instance(key);
    const destination = await instance(key);
    const otherRoom = await instance(key, 'board:32');
    const otherEnvironment = await instance(`${key}:isolated`);
    const leaked = jest.fn();
    otherRoom.client.on('task:updated', leaked);
    otherEnvironment.client.on('task:updated', leaked);
    const delivered = event(destination.client, 'task:updated');
    source.server
      .of('/board')
      .to('board:31')
      .emit('task:updated', { id: 12, assigneeIds: [7] });
    await expect(delivered).resolves.toEqual({ id: 12, assigneeIds: [7] });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(leaked).not.toHaveBeenCalled();
  });

  it('просит перечитать снимок после разрыва Redis и возобновляет доставку', async () => {
    const source = await instance(key);
    const destination = await instance(key);
    const subscriber = (destination.adapter as any).subscriber as Redis;
    await new Promise<void>(resolve => {
      subscriber.once('end', resolve);
      subscriber.disconnect();
    });
    const resync = event(destination.client, 'board:resync');
    await subscriber.connect();
    await resync;
    // Ready приходит до восстановления всех Redis-подписок; ping проходит после queued resubscribe.
    await subscriber.ping();
    const delivered = event(destination.client, 'task:updated');
    source.server.of('/board').to('board:31').emit('task:updated', { id: 13 });
    await expect(delivered).resolves.toEqual({ id: 13 });
  });

  it('закрывается без необработанных отказов команд, когда Redis уже отключён', async () => {
    const destination = await instance(key);
    const subscriber = (destination.adapter as any).subscriber as Redis;
    await new Promise<void>(resolve => {
      subscriber.once('end', resolve);
      subscriber.disconnect();
    });
    // afterEach выполняет реальный close; Jest обнаружит необработанное отклонение Promise.
  });
});
