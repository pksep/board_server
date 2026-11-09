import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import axios, { AxiosError, AxiosHeaders } from 'axios';
import cookieParser = require('cookie-parser');
import request = require('supertest');
import { TasksController } from '../tasks.controller';
import { TasksService } from '../tasks.service';

describe('Executor planning HTTP role permission', () => {
  let app: INestApplication;
  const get = jest.spyOn(axios, 'get');
  const assignments = jest
    .fn()
    .mockResolvedValue({ items: [], hasMore: false, offset: 0 });
  const workload = jest.fn().mockResolvedValue([]);
  const endpoints = ['/tasks/by-executor', '/tasks/executor-workload'];

  beforeAll(async (): Promise<void> => {
    const module = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        {
          provide: TasksService,
          useValue: {
            getPersonalTasks: assignments,
            getExecutorWorkload: workload
          }
        },
        {
          provide: ConfigService,
          useValue: new ConfigService({ erpApiUrl: 'http://erp.invalid/api/' })
        }
      ]
    }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    // Общий TokenAuth покрыт отдельно; здесь проверяется реальный guard маршрутов планирования.
    app.use((req, _res, next): void => {
      req.user = { id: 42 };
      next();
    });
    await app.init();
  });

  beforeEach((): void => {
    get.mockReset();
    assignments.mockClear();
    workload.mockClear();
  });

  afterAll(async (): Promise<void> => {
    get.mockRestore();
    await app?.close();
  });

  it.each(['production.overview', 'production.tasks'])(
    'accepts %s view without project access for both endpoints',
    async (resource): Promise<void> => {
      get.mockResolvedValue({
        data: { permissions: [{ resource_code: resource, action: 'view' }] }
      });
      for (const endpoint of endpoints) {
        await request(app.getHttpServer())
          .get(endpoint)
          .query({ erpUserId: 71 })
          .set(
            'Cookie',
            'access_token=verified-session; board_token=ignored; other=ignored'
          )
          .expect(200);
      }
      expect(assignments).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ scope: 'assigned' }),
        '71'
      );
      expect(workload).toHaveBeenCalledWith(42, { erpUserId: '71' });
      expect(get).toHaveBeenLastCalledWith(
        'http://erp.invalid/api/authorization/me',
        {
          headers: {
            Cookie: 'access_token=verified-session',
            compress: 'no-compress'
          },
          timeout: 5000,
          maxRedirects: 0,
          proxy: false
        }
      );
    }
  );

  it.each(
    [
      [],
      [{ resource_code: 'general.projects', action: 'view' }],
      [{ resource_code: 'production.tasks', action: 'update' }]
    ].map(permissions => ({ permissions }))
  )(
    'denies unrelated permissions $permissions',
    async ({ permissions }): Promise<void> => {
      get.mockResolvedValue({ data: { permissions } });
      for (const endpoint of endpoints) {
        const response = await request(app.getHttpServer())
          .get(endpoint)
          .set('Cookie', 'access_token=verified-session')
          .expect(403);
        expect(response.body).toMatchObject({
          code: 'PERMISSION_DENIED',
          requirementMode: 'anyOf'
        });
      }
      expect(assignments).not.toHaveBeenCalled();
      expect(workload).not.toHaveBeenCalled();
    }
  );

  it('does not replace an ERP session with a Board token or local fallback', async (): Promise<void> => {
    for (const endpoint of endpoints) {
      await request(app.getHttpServer())
        .get(endpoint)
        .query({ erpUserId: 71 })
        .set('Cookie', 'board_token=local-session')
        .expect(401);
    }
    expect(get).not.toHaveBeenCalled();
    expect(assignments).not.toHaveBeenCalled();
    expect(workload).not.toHaveBeenCalled();
  });

  it('rechecks revoked permissions instead of caching an allowed role', async (): Promise<void> => {
    get.mockResolvedValueOnce({
      data: {
        permissions: [{ resource_code: 'production.tasks', action: 'view' }]
      }
    });
    get.mockResolvedValueOnce({ data: { permissions: [] } });
    await request(app.getHttpServer())
      .get(endpoints[0])
      .set('Cookie', 'access_token=verified-session')
      .expect(200);
    await request(app.getHttpServer())
      .get(endpoints[0])
      .set('Cookie', 'access_token=verified-session')
      .expect(403);
    expect(assignments).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it.each([
    null,
    {},
    { permissions: true },
    { permissions: [{ resource_code: 1 }] }
  ])('rejects invalid ERP response %p', async data => {
    get.mockResolvedValue({ data });
    await request(app.getHttpServer())
      .get(endpoints[0])
      .set('Cookie', 'access_token=verified-session')
      .expect(503);
    expect(assignments).not.toHaveBeenCalled();
  });

  it.each([401, 403, 500])(
    'preserves ERP auth failure %i without exposing planning data',
    async status => {
      get.mockRejectedValue(
        new AxiosError('ERP error', 'ERR_BAD_RESPONSE', undefined, undefined, {
          status,
          statusText: 'ERP error',
          data: {},
          headers: {},
          config: { headers: new AxiosHeaders() }
        })
      );
      await request(app.getHttpServer())
        .get(endpoints[1])
        .set('Cookie', 'access_token=verified-session')
        .expect(status === 500 ? 503 : status);
      expect(workload).not.toHaveBeenCalled();
    }
  );

  it('fails closed when ERP cannot be reached', async (): Promise<void> => {
    get.mockRejectedValue(new Error('timeout'));
    await request(app.getHttpServer())
      .get(endpoints[1])
      .set('Cookie', 'access_token=verified-session')
      .expect(503);
    expect(workload).not.toHaveBeenCalled();
  });
});
