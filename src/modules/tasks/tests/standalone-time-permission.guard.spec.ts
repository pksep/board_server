import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import cookieParser = require('cookie-parser');
import request = require('supertest');
import { TimeEntriesController } from '../time-entries.controller';
import { TasksService } from '../tasks.service';

describe('Standalone time HTTP permissions', () => {
  let app: INestApplication;
  const read = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
  const create = jest.fn().mockResolvedValue({ taskId: null });
  const get = jest.spyOn(axios, 'get');
  const view = { resource_code: 'general.time-tracking', action: 'view' };
  const write = { resource_code: 'general.time-tracking', action: 'create' };

  beforeAll(async (): Promise<void> => {
    const module = await Test.createTestingModule({
      controllers: [TimeEntriesController],
      providers: [
        {
          provide: TasksService,
          useValue: { getStandaloneTimeReport: read, createTimeEntry: create }
        },
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
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true
      })
    );
    await app.init();
  });

  beforeEach((): void => {
    get.mockReset();
    read.mockClear();
    create.mockClear();
  });
  afterAll(async (): Promise<void> => {
    get.mockRestore();
    await app?.close();
  });

  it('reads with time tracking view alone and does not require projects', async (): Promise<void> => {
    get.mockResolvedValue({ data: { permissions: [view] } });
    await request(app.getHttpServer())
      .get('/time-entries')
      .query({ start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z' })
      .set('Cookie', 'access_token=test')
      .expect(200);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each([
    [],
    [view],
    [write],
    [{ resource_code: 'general.projects', action: 'create' }]
  ])(
    'denies creating without both time permissions %p',
    async (...permissions) => {
      get.mockResolvedValue({ data: { permissions } });
      await request(app.getHttpServer())
        .post('/time-entries')
        .set('Cookie', 'access_token=test')
        .send({ durationMinutes: 30 })
        .expect(403);
      expect(create).not.toHaveBeenCalled();
    }
  );

  it('forwards the credited employee but fixes the recorder to the session', async (): Promise<void> => {
    get.mockResolvedValue({ data: { permissions: [view, write] } });
    await request(app.getHttpServer())
      .post('/time-entries')
      .set('Cookie', 'access_token=test')
      .send({ durationMinutes: 30, userId: 19, comment: 'Other employee' })
      .expect(201);
    expect(create).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ userId: 19, durationMinutes: 30 }),
      42
    );
    await request(app.getHttpServer())
      .post('/time-entries')
      .set('Cookie', 'access_token=test')
      .send({ durationMinutes: 30, createdById: 19 })
      .expect(400);
  });

  it('fails closed for missing sessions, malformed ERP data and unavailable ERP', async (): Promise<void> => {
    await request(app.getHttpServer())
      .post('/time-entries')
      .send({ durationMinutes: 30 })
      .expect(401);
    get.mockResolvedValue({ data: {} });
    await request(app.getHttpServer())
      .post('/time-entries')
      .set('Cookie', 'access_token=test')
      .send({ durationMinutes: 30 })
      .expect(503);
    get.mockRejectedValue(new Error('offline'));
    await request(app.getHttpServer())
      .get('/time-entries')
      .set('Cookie', 'access_token=test')
      .expect(503);
    expect(create).not.toHaveBeenCalled();
  });
});
