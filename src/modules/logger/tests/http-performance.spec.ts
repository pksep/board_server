import {
  Controller,
  Get,
  INestApplication,
  InternalServerErrorException,
  UnauthorizedException
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Writable } from 'stream';
import request = require('supertest');
import pinoHttp from 'pino-http';
import loggerConfig from '../../../utils/logger/logger.config';
import { HttpPerformanceInterceptor } from '../http-performance.interceptor';
import { TokenAuth } from '../../auth/jwt-auth.guard';
import { HTTP_PERFORMANCE_EXPOSED_HEADERS } from '../../../utils/logger/http-performance';

@Controller('probe')
class ProbeController {
  @Get()
  get(): Record<string, number> {
    return { unchanged: 42 };
  }

  @Get('fail')
  fail(): never {
    throw new InternalServerErrorException('original failure');
  }
}

describe('Express HTTP performance without business dependencies', (): void => {
  let app: INestApplication;
  const authenticateRequest = jest.fn();
  const logLines: string[] = [];

  beforeAll(async (): Promise<void> => {
    const module = await Test.createTestingModule({
      controllers: [ProbeController]
    }).compile();
    const destination = new Writable({
      write(chunk, _encoding, callback): void {
        logLines.push(String(chunk));
        callback();
      }
    });
    app = module.createNestApplication();
    app.use(
      pinoHttp(
        { ...loggerConfig.pinoHttp, level: 'info', transport: undefined },
        destination
      )
    );
    app.enableCors({
      origin: 'https://erp.example',
      exposedHeaders: HTTP_PERFORMANCE_EXPOSED_HEADERS
    });
    app.useGlobalGuards(
      new TokenAuth(
        {} as never,
        { getAllAndOverride: () => false } as never,
        {} as never,
        {
          isEnabled: () => true,
          authenticateRequest,
          toUserPayload: () => ({ id: 7 })
        } as never
      )
    );
    app.useGlobalInterceptors(new HttpPerformanceInterceptor());
    await app.init();
  });

  beforeEach((): void => {
    logLines.length = 0;
    authenticateRequest
      .mockReset()
      .mockResolvedValue({ token: 'active', user: { id: 7 } });
  });

  afterAll(async (): Promise<void> => {
    await app.close();
  });

  it('preserves JSON/session checks and correlates Pino with browser headers', async (): Promise<void> => {
    const response = await request(app.getHttpServer())
      .get('/probe?search=private-value')
      .set('Authorization', 'Bearer active')
      .set('X-Request-Id', 'request-123')
      .set('Origin', 'https://erp.example');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ unchanged: 42 });
    expect(response.headers['x-request-id']).toBe('request-123');
    expect(response.headers['server-timing']).toMatch(
      /^app;dur=\d+\.\d+, auth;dur=\d+\.\d+$/
    );
    expect(response.headers['access-control-expose-headers']).toContain(
      'Server-Timing'
    );
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(authenticateRequest).toHaveBeenCalledTimes(1);
    const line = logLines
      .map(value => JSON.parse(value))
      .find(value => value.route === '/probe');
    expect(line.req.id).toBe('request-123');
    expect(line.authDuration).toBeGreaterThanOrEqual(0);
    expect(logLines.join('')).not.toContain('private-value');
    expect(logLines.join('')).not.toContain('Bearer active');
  });

  it('preserves guard rejection and still supplies timing', async (): Promise<void> => {
    authenticateRequest.mockRejectedValueOnce(
      new UnauthorizedException('revoked')
    );
    const response = await request(app.getHttpServer())
      .get('/probe')
      .set('Authorization', 'Bearer revoked');

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('revoked');
    expect(response.headers['server-timing']).toContain('auth;dur=');
    expect(authenticateRequest).toHaveBeenCalledTimes(1);
  });

  it('preserves handler failure and replaces an invalid incoming ID', async (): Promise<void> => {
    const response = await request(app.getHttpServer())
      .get('/probe/fail')
      .set('Authorization', 'Bearer active')
      .set('X-Request-Id', 'unsafe value');

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('original failure');
    expect(response.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.headers['server-timing']).toContain('auth;dur=');
  });
});
