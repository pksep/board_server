import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import axios, { AxiosError, AxiosHeaders } from 'axios';
import cookieParser = require('cookie-parser');
import request = require('supertest');
import { TasksController } from '../tasks.controller';
import { TasksService } from '../tasks.service';

describe('Time report HTTP role permission', () => {
  let app: INestApplication;
  const report = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
  const permissions = [
    { resource_code: 'general.time-tracking', action: 'view' },
    { resource_code: 'general.projects', action: 'view' }
  ];
  const get = jest.spyOn(axios, 'get');

  beforeAll(async (): Promise<void> => {
    const module = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        { provide: TasksService, useValue: { getTimeReport: report } },
        {
          provide: ConfigService,
          useValue: new ConfigService({ erpApiUrl: 'http://erp.invalid/api/' })
        }
      ]
    }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.use((req, _res, next): void => {
      req.user = { id: 42 };
      next();
    });
    await app.init();
  });

  beforeEach((): void => {
    get.mockReset();
    report.mockClear();
    get.mockResolvedValue({ data: { permissions } });
  });

  afterAll(async (): Promise<void> => {
    get.mockRestore();
    await app?.close();
  });

  it('allows both permissions and forwards only the verified ERP cookie', async (): Promise<void> => {
    await request(app.getHttpServer())
      .get('/tasks/time-report')
      .set(
        'Cookie',
        'access_token=erp-session; board_token=board-session; other=private'
      )
      .expect(200);
    expect(report).toHaveBeenCalledWith(42, {});
    expect(get).toHaveBeenCalledWith(
      'http://erp.invalid/api/authorization/me',
      {
        headers: {
          Cookie: 'access_token=erp-session',
          compress: 'no-compress'
        },
        timeout: 5000,
        maxRedirects: 0,
        proxy: false
      }
    );
  });

  it.each(
    [
      [],
      [permissions[0]],
      [permissions[1]],
      [
        { resource_code: 'general.work-results', action: 'view' },
        permissions[1]
      ],
      [
        { resource_code: 'general.time-tracking', action: 'update' },
        permissions[1]
      ]
    ].map(selection => ({ selection }))
  )('denies incomplete or unrelated permissions %p', async ({ selection }) => {
    get.mockResolvedValue({ data: { permissions: selection } });
    const response = await request(app.getHttpServer())
      .get('/tasks/time-report')
      .set('Cookie', 'access_token=erp-session')
      .expect(403);
    expect(response.body.code).toBe('PERMISSION_DENIED');
    expect(report).not.toHaveBeenCalled();
  });

  it('does not reuse an allowed response after the role permission is revoked', async (): Promise<void> => {
    await request(app.getHttpServer())
      .get('/tasks/time-report')
      .set('Cookie', 'access_token=erp-session')
      .expect(200);
    report.mockClear();
    get.mockResolvedValue({ data: { permissions: [permissions[1]] } });
    await request(app.getHttpServer())
      .get('/tasks/time-report')
      .set('Cookie', 'access_token=erp-session')
      .expect(403);
    expect(get).toHaveBeenCalledTimes(2);
    expect(report).not.toHaveBeenCalled();
  });

  it('does not grant report access from a Board cookie or dev fallback', async (): Promise<void> => {
    await request(app.getHttpServer())
      .get('/tasks/time-report')
      .set('Cookie', 'board_token=local-session')
      .expect(401);
    expect(get).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { permissions: true },
    { permissions: [{ resource_code: 1 }] }
  ])('fails closed for an invalid ERP response %p', async data => {
    get.mockResolvedValue({ data });
    await request(app.getHttpServer())
      .get('/tasks/time-report')
      .set('Cookie', 'access_token=erp-session')
      .expect(503);
    expect(report).not.toHaveBeenCalled();
  });

  it.each([401, 403, 500])(
    'handles ERP rejection %i without reading tasks',
    async status => {
      const error = new AxiosError('ERP failure');
      error.response = {
        status,
        data: {},
        statusText: 'failure',
        headers: {},
        config: { headers: new AxiosHeaders() }
      };
      get.mockRejectedValue(error);
      await request(app.getHttpServer())
        .get('/tasks/time-report')
        .set('Cookie', 'access_token=erp-session')
        .expect(status === 500 ? 503 : status);
      expect(report).not.toHaveBeenCalled();
    }
  );

  it('fails closed when ERP cannot be reached', async (): Promise<void> => {
    get.mockRejectedValue(new Error('timeout'));
    await request(app.getHttpServer())
      .get('/tasks/time-report')
      .set('Cookie', 'access_token=erp-session')
      .expect(503);
    expect(report).not.toHaveBeenCalled();
  });
});
