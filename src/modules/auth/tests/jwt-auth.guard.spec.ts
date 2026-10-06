import { UnauthorizedException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common/interfaces';
import { TokenAuth, getRequestUrl } from '../jwt-auth.guard';

describe('TokenAuth request URL handling', () => {
  const createGuard = () =>
    new TokenAuth(
      { verify: jest.fn(), sign: jest.fn() } as never,
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as never,
      { findOne: jest.fn() } as never,
      { isEnabled: jest.fn().mockReturnValue(false) } as never
    );

  const createContext = (request: Record<string, unknown>) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      getType: jest.fn().mockReturnValue('http'),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(request),
        getResponse: jest.fn().mockReturnValue({ cookie: jest.fn() })
      })
    }) as unknown as ExecutionContext;

  it.each([
    [{ originalUrl: undefined, url: '/api/sse-events' }, '/api/sse-events'],
    [{ originalUrl: null, url: '/api/projects' }, '/api/projects'],
    [{ originalUrl: undefined, url: undefined }, null],
    [{ originalUrl: 42, url: null }, null]
  ])('normalizes request URL from %p', (request, expected) => {
    expect(getRequestUrl(request)).toBe(expected);
  });

  it('allows SSE when originalUrl is undefined and url contains the SSE route', async () => {
    const guard = createGuard();
    const context = createContext({
      originalUrl: undefined,
      url: '/api/sse-events',
      hostname: 'prod.pksep.ru',
      cookies: {}
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it.each([undefined, null])(
    'continues normal auth when request URL is %p instead of throwing TypeError',
    async missingUrl => {
      const guard = createGuard();
      const context = createContext({
        originalUrl: missingUrl,
        url: missingUrl,
        hostname: 'prod.pksep.ru',
        cookies: {}
      });

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        UnauthorizedException
      );
    }
  );

  it('в режиме SEP Auth игнорирует board_token и проверяет access_token', async () => {
    const verify = jest.fn();
    const authenticate = jest.fn().mockResolvedValue({ id: 7 });
    const toUserPayload = jest.fn().mockReturnValue({
      id: 7,
      login: 'reader',
      serviceNumber: '007'
    });
    const guard = new TokenAuth(
      { verify } as never,
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as never,
      { findOne: jest.fn() } as never,
      {
        isEnabled: jest.fn().mockReturnValue(true),
        authenticate,
        toUserPayload
      } as never
    );
    const request = {
      originalUrl: '/api/boards',
      hostname: 'board.example.test',
      cookies: { board_token: 'old-board', access_token: 'new-auth' },
      headers: {}
    };
    const context = createContext(request);
    const response = context.switchToHttp().getResponse();
    response.clearCookie = jest.fn();

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(authenticate).toHaveBeenCalledWith('new-auth');
    expect(verify).not.toHaveBeenCalled();
    expect(response.clearCookie).toHaveBeenCalledWith('board_token', {
      path: '/'
    });
    expect(request).toHaveProperty('user', {
      id: 7,
      login: 'reader',
      serviceNumber: '007'
    });
  });

  it('не принимает старый board_token без общей сессии', async () => {
    const verify = jest.fn();
    const guard = new TokenAuth(
      { verify } as never,
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as never,
      { findOne: jest.fn() } as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never
    );
    const context = createContext({
      originalUrl: '/api/boards',
      hostname: 'board.example.test',
      cookies: { board_token: 'old-board' },
      headers: {}
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
    expect(verify).not.toHaveBeenCalled();
  });

  it('не обходит SEP Auth для SSE по имени URL', async () => {
    const guard = new TokenAuth(
      { verify: jest.fn() } as never,
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as never,
      { findOne: jest.fn() } as never,
      { isEnabled: jest.fn().mockReturnValue(true) } as never
    );
    const context = createContext({
      originalUrl: '/api/sse-events',
      hostname: 'board.example.test',
      cookies: {},
      headers: {}
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });
});
