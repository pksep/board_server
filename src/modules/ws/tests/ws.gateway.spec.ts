import { WsGateway } from '../ws.gateway';

describe('WsGateway connection authentication', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  /** Создаёт gateway с изолированными зависимостями для проверки cookie. */
  const createGateway = (verify: jest.Mock) =>
    new WsGateway({ verify } as any, {} as any, {} as any);

  /** Создаёт минимальный Socket.IO-клиент с переданной строкой cookie. */
  const createClient = (cookieHeader: string) =>
    ({
      id: 'socket-1',
      handshake: { headers: { cookie: cookieHeader } },
      disconnect: jest.fn()
    }) as any;

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });

  afterAll(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
      return;
    }
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('предпочитает собственный board_token при наличии двух cookie', () => {
    const verify = jest.fn().mockReturnValue({ id: 7, login: 'reader' });
    const gateway = createGateway(verify);
    const client = createClient(
      'access_token=erp-token; board_token=board-token'
    );

    gateway.handleConnection(client);

    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith('board-token');
    expect(client.user).toEqual({ id: 7, login: 'reader' });
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('проверяет access_token после невалидного board_token', () => {
    const verify = jest.fn((token: string) => {
      if (token === 'board-token') throw new Error('expired');
      return { id: 8, login: 'editor' };
    });
    const gateway = createGateway(verify);
    const client = createClient(
      'board_token=board-token; access_token=erp-token'
    );

    gateway.handleConnection(client);

    expect(verify.mock.calls).toEqual([['board-token'], ['erp-token']]);
    expect(client.user).toEqual({ id: 8, login: 'editor' });
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('отключает клиента без валидной серверной сессии', () => {
    const verify = jest.fn(() => {
      throw new Error('invalid');
    });
    const gateway = createGateway(verify);
    const client = createClient('board_token=invalid-token');

    gateway.handleConnection(client);

    expect(client.user).toBeUndefined();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('не подписывает пользователя без доступа на общую комнату доски', async () => {
    const access = {
      assertCanRead: jest.fn().mockRejectedValue(new Error('denied'))
    };
    const gateway = new WsGateway(
      {} as any,
      { findByPk: jest.fn().mockResolvedValue({ projectId: 3 }) } as any,
      access as any
    );
    const client = { user: { id: 7 }, join: jest.fn() } as any;
    await expect(
      gateway.handleJoinBoard(client, { boardId: 2 })
    ).resolves.toEqual({
      event: 'error',
      data: { message: 'Доска не найдена' }
    });
    expect(client.join).not.toHaveBeenCalled();
  });

  it('подтверждает подписку только после фактического присоединения к комнате', async () => {
    let joined!: () => void;
    const gate = new Promise<void>(resolve => {
      joined = resolve;
    });
    const gateway = new WsGateway(
      {} as any,
      { findByPk: jest.fn().mockResolvedValue({ projectId: 3 }) } as any,
      { assertCanRead: jest.fn().mockResolvedValue(undefined) } as any
    );
    const client = {
      id: 'socket-1',
      user: { id: 7 },
      join: jest.fn().mockReturnValue(gate)
    } as any;
    let acknowledged = false;
    const result = gateway
      .handleJoinBoard(client, { boardId: 2 })
      .then(value => {
        acknowledged = true;
        return value;
      });
    await new Promise(resolve => setImmediate(resolve));
    expect(client.join).toHaveBeenCalledWith('board:2');
    expect(acknowledged).toBe(false);
    joined();
    await expect(result).resolves.toEqual({
      event: 'board:joined',
      data: { boardId: 2 }
    });
  });
});
