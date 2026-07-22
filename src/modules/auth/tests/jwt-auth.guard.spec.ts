import { UnauthorizedException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common/interfaces';
import { TokenAuth, getRequestUrl } from '../jwt-auth.guard';

describe('TokenAuth request URL handling', () => {
  const createGuard = () =>
    new TokenAuth(
      { verify: jest.fn(), sign: jest.fn() } as never,
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as never,
      { findOne: jest.fn() } as never,
      { get: jest.fn() } as never
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
});
