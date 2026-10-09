import { WsGateway } from '../ws.gateway';
import { getErpSessionHash } from '../../auth/utils/board-session';

describe('WsGateway connection authentication', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  it('distinguishes read-only invalidation without changing the existing task-change signal', (): void => {
    const gateway = createGateway(jest.fn());
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    gateway.server = { to } as typeof gateway.server;

    gateway.emitTaskActivityChanged([7], true);
    expect(to).toHaveBeenCalledWith(['user:7']);
    expect(emit).toHaveBeenLastCalledWith('activity:changed', {
      readOnly: true
    });
    gateway.emitTaskActivityChanged([7]);
    expect(emit).toHaveBeenLastCalledWith('activity:changed');
  });

  /** Создаёт gateway с изолированными зависимостями для проверки cookie. */
  const createGateway = (verify: jest.Mock) =>
    new WsGateway(
      { verify } as any,
      {} as any,
      {} as any,
      { isEnabled: jest.fn().mockReturnValue(false) } as any
    );

  /** Создаёт минимальный Socket.IO-клиент с переданной строкой cookie. */
  const createClient = (cookieHeader: string) =>
    ({
      id: 'socket-1',
      handshake: { headers: { cookie: cookieHeader } },
      join: jest.fn(),
      emit: jest.fn(),
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

  it('принимает board_token, привязанный к текущей ERP-сессии', async () => {
    const user = {
      id: 7,
      login: 'reader',
      erpTokenHash: getErpSessionHash('erp-token')
    };
    const verify = jest.fn().mockReturnValue(user);
    const gateway = createGateway(verify);
    const client = createClient(
      'access_token=erp-token; board_token=board-token'
    );

    await gateway.handleConnection(client);

    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith('board-token');
    expect(client.user).toEqual(user);
    expect(client.join).toHaveBeenCalledWith('user:7');
    expect(client.emit).toHaveBeenCalledWith('activity:ready');
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('не использует ERP ID как ID доски после невалидного board_token', async () => {
    const verify = jest.fn((token: string) => {
      if (token === 'board-token') throw new Error('expired');
      return { id: 8, login: 'editor' };
    });
    const gateway = createGateway(verify);
    const client = createClient(
      'board_token=board-token; access_token=erp-token'
    );

    await gateway.handleConnection(client);

    expect(verify.mock.calls).toEqual([['board-token']]);
    expect(client.user).toBeUndefined();
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
  });

  it.each(['erp-B', undefined])(
    'отклоняет канал старого аккаунта при ERP-cookie %p',
    async erpToken => {
      const verify = jest
        .fn()
        .mockReturnValue({ id: 7, erpTokenHash: getErpSessionHash('erp-A') });
      const gateway = createGateway(verify);
      const client = createClient(
        `board_token=board-A${erpToken ? `; access_token=${erpToken}` : ''}`
      );

      await gateway.handleConnection(client);

      expect(client.user).toBeUndefined();
      expect(client.disconnect).toHaveBeenCalledWith(true);
    }
  );

  it('не подменяет неверную сессию dev-пользователем', async () => {
    process.env.NODE_ENV = 'development';
    const gateway = createGateway(jest.fn().mockReturnValue({ id: 7 }));
    const client = createClient('board_token=old-token; access_token=erp-B');

    await gateway.handleConnection(client);

    expect(client.user).toBeUndefined();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('сохраняет локальный dev-вход без обеих cookie', async () => {
    process.env.NODE_ENV = 'development';
    const client = createClient('');

    await createGateway(jest.fn()).handleConnection(client);

    expect(client.user.id).toBe(1);
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('отключает клиента без валидной серверной сессии', async () => {
    const verify = jest.fn(() => {
      throw new Error('invalid');
    });
    const gateway = createGateway(verify);
    const client = createClient('board_token=invalid-token');

    await gateway.handleConnection(client);

    expect(client.user).toBeUndefined();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('в режиме SEP Auth проверяет access_token даже при наличии board_token', async () => {
    const verify = jest.fn();
    const authenticate = jest.fn().mockResolvedValue({ id: 8 });
    const gateway = new WsGateway(
      { verify } as any,
      {} as any,
      {} as any,
      {
        isEnabled: jest.fn().mockReturnValue(true),
        authenticate,
        toUserPayload: jest.fn().mockReturnValue({
          id: 8,
          login: 'editor',
          serviceNumber: '008'
        })
      } as any
    );
    const client = createClient('board_token=old-board; access_token=new-auth');

    await gateway.handleConnection(client);

    expect(authenticate).toHaveBeenCalledWith('new-auth');
    expect(verify).not.toHaveBeenCalled();
    expect(client.user.id).toBe(8);
    expect(client.join).toHaveBeenCalledWith('user:8');
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('не принимает board_token без access_token при включённом SEP Auth', async () => {
    const gateway = new WsGateway(
      { verify: jest.fn() } as any,
      {} as any,
      {} as any,
      { isEnabled: jest.fn().mockReturnValue(true) } as any
    );
    const client = createClient('board_token=old-board');

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('не подписывает сокет на комнату до завершения проверки токена', async () => {
    const findByPk = jest.fn();
    const assertCanRead = jest.fn();
    const gateway = new WsGateway(
      {} as any,
      { findByPk } as any,
      { assertCanRead } as any,
      { isEnabled: jest.fn().mockReturnValue(true) } as any
    );
    const client = { join: jest.fn() } as any;

    await expect(
      gateway.handleJoinBoard(client, { boardId: 2 })
    ).resolves.toEqual({
      event: 'error',
      data: { message: 'Не авторизован' }
    });
    await expect(
      gateway.handleJoinProject(client, { projectId: 3 })
    ).resolves.toEqual({
      event: 'error',
      data: { message: 'Не авторизован' }
    });
    expect(findByPk).not.toHaveBeenCalled();
    expect(assertCanRead).not.toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
  });

  it('не подписывает пользователя без доступа на общую комнату доски', async () => {
    const access = {
      assertCanRead: jest.fn().mockRejectedValue(new Error('denied'))
    };
    const gateway = new WsGateway(
      {} as any,
      { findByPk: jest.fn().mockResolvedValue({ projectId: 3 }) } as any,
      access as any,
      { isEnabled: jest.fn().mockReturnValue(false) } as any
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
      { assertCanRead: jest.fn().mockResolvedValue(undefined) } as any,
      { isEnabled: jest.fn().mockReturnValue(false) } as any
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
