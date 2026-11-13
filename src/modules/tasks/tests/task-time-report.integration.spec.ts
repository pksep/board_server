import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import { Sequelize } from 'sequelize-typescript';
import request = require('supertest');
import models from '../../../configs/models';
import { TasksService } from '../tasks.service';
import { TaskCommentCountersService } from '../../task-comment-counters/task-comment-counters.service';
import { TasksController } from '../tasks.controller';
import { TimeEntriesController } from '../time-entries.controller';
import { TimeReportPermissionGuard } from '../time-report-permission.guard';
import { StandaloneTimePermissionGuard } from '../standalone-time-permission.guard';
import { ExecutorPlanningPermissionGuard } from '../executor-planning-permission.guard';
import { ProjectAccessService } from '../../projects/project-access.service';
import { Project } from '../../projects/model/project.model';
import { ProjectMember } from '../../projects/model/project-member.model';
import { Board } from '../../boards/model/board.model';
import { BoardColumn } from '../../columns/model/board-column.model';
import { Task } from '../model/task.model';
import { User } from '../../users/model/users.model';
import { WsGateway } from '../../ws/ws.gateway';
import { S3Service } from '../../s3/s3.service';
import { ActivityEventsService } from '../../activity-events/activity-events.service';

const databaseUrl = process.env.BOARD_ARCHIVE_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('Persisted task time report and project access', () => {
  let sequelize: Sequelize;
  let app: INestApplication;
  let service: TasksService;
  let owner: User;
  let member: User;
  let outsider: User;
  let task: Task;
  let project: Project;
  const period = { start: '2026-10-18T21:00:00Z', end: '2026-10-25T21:00:00Z' };

  beforeAll(async (): Promise<void> => {
    if (
      !/^\/board_archive_test_[a-z0-9_]+$/.test(new URL(databaseUrl!).pathname)
    ) {
      throw new Error(
        'Time report tests require an isolated board_archive_test_* database'
      );
    }
    sequelize = new Sequelize(databaseUrl!, {
      dialect: 'postgres',
      models,
      logging: false,
      pool: { max: 2, min: 0 }
    });
    await sequelize.sync();
    // Используем настоящую миграцию таблицы записей времени.
    await require('../../../../migrations/2026/30.09.2026/20260930120000-create-task-time-entries.js').up(
      sequelize.getQueryInterface()
    );
    await require('../../../../migrations/2026/13.11.2026/20261113120000-standalone-time-entries.js').up(
      sequelize.getQueryInterface()
    );
    const module = await Test.createTestingModule({
      controllers: [TasksController, TimeEntriesController],
      providers: [
        TasksService,
        {
          provide: TaskCommentCountersService,
          useValue: { attachToTasks: jest.fn() }
        },
        ProjectAccessService,
        ...models.map(model => ({
          provide: getModelToken(model),
          useValue: model
        })),
        { provide: Sequelize, useValue: sequelize },
        { provide: WsGateway, useValue: {} },
        { provide: S3Service, useValue: {} },
        { provide: ActivityEventsService, useValue: {} }
      ]
    })
      // Матрица роли проверяется через HTTP в time-report-permission.guard.spec.ts.
      // Здесь изолированно проверяются реальные записи и права конкретного проекта.
      .overrideGuard(ExecutorPlanningPermissionGuard)
      .useValue({ canActivate: (): boolean => true })
      .overrideGuard(TimeReportPermissionGuard)
      .useValue({ canActivate: (): boolean => true })
      .overrideGuard(StandaloneTimePermissionGuard)
      .useValue({ canActivate: (): boolean => true })
      .compile();
    service = module.get(TasksService);
    owner = await User.build()
      .set({
        erpId: '88001',
        login: 'Time owner',
        initial: 'TO',
        serviceNumber: 'time-owner',
        role: '-'
      })
      .save();
    member = await User.build()
      .set({
        erpId: '88002',
        login: 'Time member',
        initial: 'TM',
        serviceNumber: 'time-member',
        role: '-'
      })
      .save();
    outsider = await User.build()
      .set({
        erpId: '88003',
        login: 'Time outsider',
        initial: 'TX',
        serviceNumber: 'time-outsider',
        role: 'admin'
      })
      .save();
    project = await Project.build()
      .set({ title: 'Time reporting', prefix: 'QATIME', createdById: owner.id })
      .save();
    await ProjectMember.build()
      .set({ projectId: project.id, userId: member.id })
      .save();
    const board = await Board.build()
      .set({ title: 'Time board', projectId: project.id })
      .save();
    const column = await BoardColumn.build()
      .set({ title: 'Time column', boardId: board.id })
      .save();
    task = await Task.build()
      .set({
        title: 'Persisted time',
        taskNumber: 1,
        columnId: column.id,
        createdById: owner.id
      })
      .save();
    for (const [date, minutes] of [
      [period.start, 20],
      ['2026-10-20T10:00:00Z', 40],
      [period.end, 90]
    ]) {
      await sequelize.query(
        'INSERT INTO task_time_entries (task_id, user_id, duration_minutes, "createdAt") VALUES (:task, :actor, :minutes, :date)',
        {
          replacements: { task: task.id, actor: member.id, minutes, date }
        }
      );
    }
    app = module.createNestApplication();
    app.use((req, _res, next): void => {
      req.user = { id: owner.id };
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

  afterAll(async (): Promise<void> => {
    await app?.close();
    await sequelize?.close();
  });

  it('uses inclusive start, exclusive end and the author instead of the owner', async (): Promise<void> => {
    const response = await request(app.getHttpServer())
      .get('/tasks/time-report')
      .query(period)
      .expect(200);
    expect(response.body.items).toHaveLength(2);
    expect(response.body.items.map(item => item.durationMinutes)).toEqual([
      40, 20
    ]);
    expect(response.body.items[0]).toMatchObject({
      userId: member.id,
      erpUserId: '88002',
      serviceNumber: 'time-member',
      projectId: project.id,
      taskId: task.id
    });
  });

  it('returns the same history to a member and nothing to an outsider, regardless of global role', async (): Promise<void> => {
    expect((await service.getTimeReport(member.id, period)).items).toHaveLength(
      2
    );
    expect((await service.getTimeReport(outsider.id, period)).items).toEqual(
      []
    );
  });

  it('pages without repeating records', async (): Promise<void> => {
    const first = await service.getTimeReport(owner.id, {
      ...period,
      limit: 1
    });
    const second = await service.getTimeReport(owner.id, {
      ...period,
      limit: 1,
      beforeId: first.nextCursor!
    });
    expect(
      first.items[0].durationMinutes + second.items[0].durationMinutes
    ).toBe(60);
    expect(first.items[0].id).not.toBe(second.items[0].id);
    expect(second.nextCursor).toBeNull();
  });

  it('rejects missing, invalid, reversed and excessively large periods at the HTTP boundary', async (): Promise<void> => {
    for (const query of [
      {},
      { ...period, start: 'invalid' },
      { start: period.end, end: period.start },
      { ...period, end: '2027-01-01T00:00:00Z' },
      { ...period, limit: 501 }
    ]) {
      await request(app.getHttpServer())
        .get('/tasks/time-report')
        .query(query)
        .expect(400);
    }
  });

  it('retains recorded time when a task is archived, just like its time history', async (): Promise<void> => {
    await task.destroy();
    expect((await service.getTimeReport(owner.id, period)).items).toHaveLength(
      2
    );
    await task.restore();
  });

  it('does not expose the history of an archived project', async (): Promise<void> => {
    await project.destroy();
    expect((await service.getTimeReport(owner.id, period)).items).toEqual([]);
    await project.restore();
  });

  it('credits a project member while preserving the actual recorder', async (): Promise<void> => {
    const response = await request(app.getHttpServer())
      .post(`/tasks/${task.id}/time-entries`)
      .send({
        durationMinutes: 75,
        userId: member.id,
        comment: '  Для участника  '
      })
      .expect(201);
    expect(response.body).toMatchObject({
      taskId: task.id,
      userId: member.id,
      createdById: owner.id,
      durationMinutes: 75,
      comment: 'Для участника',
      actor: { id: member.id }
    });
    const history = await service.getTimeEntries(task.id, owner.id, {});
    expect(
      history.items.find(entry => entry.id === response.body.id)
    ).toMatchObject({ userId: member.id, createdById: owner.id });
    await sequelize.query('DELETE FROM task_time_entries WHERE id = :id', {
      replacements: { id: response.body.id }
    });
  });

  it('rejects assigning task time to an outsider or blocked employee without inserting data', async (): Promise<void> => {
    await request(app.getHttpServer())
      .post(`/tasks/${task.id}/time-entries`)
      .send({ durationMinutes: 30, userId: outsider.id })
      .expect(400);
    await member.update({ ban: true });
    try {
      await request(app.getHttpServer())
        .post(`/tasks/${task.id}/time-entries`)
        .send({ durationMinutes: 30, userId: member.id })
        .expect(400);
      await request(app.getHttpServer())
        .post('/time-entries')
        .send({ durationMinutes: 30, userId: member.id })
        .expect(400);
    } finally {
      await member.update({ ban: false });
    }
  });

  it('creates independent time, pages its report and keeps task reports unchanged', async (): Promise<void> => {
    const created: number[] = [];
    const now = new Date();
    const range = {
      start: new Date(now.getTime() - 60000).toISOString(),
      end: new Date(now.getTime() + 60000).toISOString()
    };
    try {
      for (const payload of [
        { durationMinutes: 25 },
        { durationMinutes: 35, userId: outsider.id, comment: 'Без задачи' }
      ]) {
        const response = await request(app.getHttpServer())
          .post('/time-entries')
          .send(payload)
          .expect(201);
        created.push(response.body.id);
        expect(response.body).toMatchObject({
          taskId: null,
          userId: payload.userId ?? owner.id,
          createdById: owner.id
        });
      }
      const page = await service.getStandaloneTimeReport({
        ...range,
        limit: 1
      });
      expect(page.items[0]).toMatchObject({
        id: created[1],
        userId: outsider.id,
        actor: { id: outsider.id },
        serviceNumber: outsider.serviceNumber
      });
      const next = await service.getStandaloneTimeReport({
        ...range,
        limit: 1,
        beforeId: page.nextCursor!
      });
      expect(next.items[0].id).toBe(created[0]);
      expect(next.nextCursor).toBeNull();
      expect((await service.getTimeReport(owner.id, range)).items).toEqual([]);
      await expect(
        require('../../../../migrations/2026/13.11.2026/20261113120000-standalone-time-entries.js').down(
          sequelize.getQueryInterface()
        )
      ).rejects.toThrow('Cannot roll back');
      expect((await service.getStandaloneTimeReport(range)).items).toHaveLength(
        2
      );
    } finally {
      for (const id of created)
        await sequelize.query('DELETE FROM task_time_entries WHERE id = :id', {
          replacements: { id }
        });
    }
  });

  it('validates independent entries and refuses recorder spoofing', async (): Promise<void> => {
    for (const body of [
      { durationMinutes: 0 },
      { durationMinutes: 1.5 },
      { durationMinutes: 10, userId: -1 },
      { durationMinutes: 10, userId: 99999999 },
      { durationMinutes: 10, createdById: outsider.id },
      { durationMinutes: 10, comment: 'a'.repeat(2001) }
    ]) {
      await request(app.getHttpServer())
        .post('/time-entries')
        .send(body)
        .expect(400);
    }
    await request(app.getHttpServer())
      .get('/time-entries')
      .query({ start: period.end, end: period.start })
      .expect(400);
  });

  it('keeps old inserts compatible and rolls back without losing the original history', async (): Promise<void> => {
    const migration = require('../../../../migrations/2026/13.11.2026/20261113120000-standalone-time-entries.js');
    expect(
      (await service.getTimeEntries(task.id, owner.id, {})).items.every(
        entry => entry.createdById === member.id
      )
    ).toBe(true);
    await migration.up(sequelize.getQueryInterface());
    await migration.down(sequelize.getQueryInterface());
    await migration.up(sequelize.getQueryInterface());
    expect((await service.getTimeReport(owner.id, period)).items).toHaveLength(
      2
    );
  });
});
