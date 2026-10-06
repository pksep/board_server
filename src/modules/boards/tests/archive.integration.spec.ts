import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import { Attributes, Model } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import request = require('supertest');
import models from '../../../configs/models';
import { BoardsController } from '../boards.controller';
import { BoardsService } from '../boards.service';
import { Board } from '../model/board.model';
import { BoardColumn } from '../../columns/model/board-column.model';
import { Project } from '../../projects/model/project.model';
import { ProjectMember } from '../../projects/model/project-member.model';
import { ProjectAccessService } from '../../projects/project-access.service';
import { ProjectTag } from '../../tags/model/project-tag.model';
import { User } from '../../users/model/users.model';
import { Task } from '../../tasks/model/task.model';
import { TaskAssignee } from '../../tasks/model/task-assignee.model';
import { TaskTag } from '../../tasks/model/task-tag.model';
import { TaskAttachment } from '../../tasks/model/task-attachment.model';
import { TasksController } from '../../tasks/tasks.controller';
import { TasksService } from '../../tasks/tasks.service';
import { ActivityEvent } from '../../activity-events/model/activity-event.model';
import { ActivityEventsService } from '../../activity-events/activity-events.service';
import { S3Service } from '../../s3/s3.service';
import { WsGateway } from '../../ws/ws.gateway';

const databaseUrl = process.env.BOARD_ARCHIVE_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

/** Создаёт тестовую запись с настоящими ограничениями модели. */
async function persist<T extends Model>(
  record: T,
  values: Partial<Attributes<T>>
): Promise<T> {
  record.set(values);

  return record.save();
}

// Нельзя запускать sync на рабочей базе: допускается только специально созданный тестовый контур.
describeWithDatabase('Archive API with isolated PostgreSQL', () => {
  let sequelize: Sequelize;
  let app: INestApplication;
  let boards: BoardsService;
  let tasks: TasksService;
  let owner: User;
  let outsider: User;
  let project: Project;
  let board: Board;
  let columns: BoardColumn[];
  let root: Task;
  let child: Task;
  let previouslyArchived: Task;
  let sequence = 0;
  const ws = {
    emitTaskCreated: jest.fn(),
    emitTaskUpdated: jest.fn(),
    emitTaskDeleted: jest.fn(),
    emitBoardReordered: jest.fn()
  };

  beforeAll(async (): Promise<void> => {
    const url = new URL(databaseUrl!);
    if (!/^\/board_archive_test_[a-z0-9_]+$/.test(url.pathname)) {
      throw new Error(
        'Archive tests require a dedicated board_archive_test_* database'
      );
    }

    sequelize = new Sequelize(databaseUrl!, {
      dialect: 'postgres',
      models,
      logging: false,
      pool: { max: 2, min: 0 }
    });
    await sequelize.sync();
    const module = await Test.createTestingModule({
      controllers: [BoardsController, TasksController],
      providers: [
        BoardsService,
        TasksService,
        ProjectAccessService,
        ActivityEventsService,
        ...models.map(model => ({
          provide: getModelToken(model),
          useValue: model
        })),
        { provide: Sequelize, useValue: sequelize },
        { provide: WsGateway, useValue: ws },
        { provide: S3Service, useValue: {} }
      ]
    }).compile();
    app = module.createNestApplication();
    // Проверка проекта остаётся настоящей; токен заменён только внутри изолированного тестового приложения.
    app.use(
      (
        req: { user?: { id: number }; headers: Record<string, string> },
        _res: unknown,
        next: () => void
      ): void => {
        req.user = { id: Number(req.headers['x-test-user']) };
        next();
      }
    );
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true })
    );
    await app.init();
    boards = module.get(BoardsService);
    tasks = module.get(TasksService);
    owner = await persist(User.build(), {
      initial: 'Owner',
      login: 'Owner',
      serviceNumber: 'archive-owner'
    });
    outsider = await persist(User.build(), {
      initial: 'Outsider',
      login: 'Outsider',
      serviceNumber: 'archive-outsider'
    });
  });

  beforeEach(async (): Promise<void> => {
    sequence += 1;
    project = await persist(Project.build(), {
      title: 'Archive QA',
      prefix: `ARC${String.fromCharCode(64 + sequence)}`,
      createdById: owner.id
    });
    await persist(ProjectMember.build(), {
      projectId: project.id,
      userId: owner.id
    });
    board = await persist(Board.build(), {
      projectId: project.id,
      title: 'Original board',
      order: 3
    });
    columns = await Promise.all(
      ['First', 'Second'].map((title, order) =>
        persist(BoardColumn.build(), {
          boardId: board.id,
          title,
          order,
          color: '#548CF6'
        })
      )
    );
    root = await persist(Task.build(), {
      title: 'Root archive task',
      description: '<p>Original text</p>',
      taskNumber: 1,
      columnId: columns[0].id,
      createdById: owner.id,
      customAttributeValues: { score: 123 },
      order: 7
    });
    child = await persist(Task.build(), {
      title: 'Child archive task',
      taskNumber: 2,
      columnId: columns[1].id,
      parentTaskId: root.id,
      createdById: owner.id,
      order: 9
    });
    previouslyArchived = await persist(Task.build(), {
      title: 'Already archived',
      taskNumber: 3,
      columnId: columns[0].id,
      createdById: owner.id
    });
    await previouslyArchived.destroy();
    const tag = await persist(ProjectTag.build(), {
      projectId: project.id,
      label: 'QA',
      color: '#548CF6'
    });
    await persist(TaskAssignee.build(), { taskId: root.id, userId: owner.id });
    await persist(TaskTag.build(), { taskId: root.id, projectTagId: tag.id });
    await persist(TaskAttachment.build(), {
      taskId: root.id,
      uploadedById: owner.id,
      fileName: 'qa.txt',
      objectName: 'qa/test-only.txt',
      mimeType: 'text/plain',
      size: 12
    });
  });

  afterAll(async (): Promise<void> => {
    await app?.close();
    await sequelize?.close();
  });

  it.each(['startDate', 'dueDate'] as const)(
    'отбирает %s до пагинации, включая начало и последний момент дня',
    async (field): Promise<void> => {
      const from = '2026-09-30T21:00:00.000Z';
      const to = '2026-10-01T20:59:59.999Z';
      await persist(root, { [field]: new Date(from) });
      await persist(child, { columnId: columns[0].id, [field]: new Date(to) });
      for (const [index, date] of [
        '2026-09-30T20:59:59.999Z',
        '2026-10-01T21:00:00.000Z'
      ].entries()) {
        await persist(Task.build(), {
          title: 'Outside period',
          taskNumber: 10 + index,
          columnId: columns[0].id,
          createdById: owner.id,
          [field]: new Date(date),
          order: 0
        });
      }

      const query = {
        [`${field}From`]: from,
        [`${field}To`]: to,
        limit: 1,
        includeSubtasks: true,
        flatSubtasks: true
      };
      const first = await request(app.getHttpServer())
        .get(`/columns/${columns[0].id}/tasks`)
        .query(query)
        .set('x-test-user', String(owner.id))
        .expect(200);
      const second = await request(app.getHttpServer())
        .get(`/columns/${columns[0].id}/tasks`)
        .query({ ...query, offset: 1 })
        .set('x-test-user', String(owner.id))
        .expect(200);

      expect(first.body).toMatchObject({
        total: 2,
        rootTotal: 1,
        hasMore: true
      });
      expect(
        first.body.items.map((item: { id: number }): number => item.id)
      ).toEqual([root.id]);
      expect(second.body).toMatchObject({ total: 2, hasMore: false });
      expect(
        second.body.items.map((item: { id: number }): number => item.id)
      ).toEqual([child.id]);
    }
  );

  it('период без одной границы работает, пустые даты не совпадают с отбором', async (): Promise<void> => {
    await persist(child, {
      columnId: columns[0].id,
      dueDate: new Date('2026-10-01T12:00:00Z')
    });
    const base = { includeSubtasks: true, flatSubtasks: true, limit: 10 };
    for (const dateQuery of [
      { dueDateFrom: '2026-10-01T00:00:00Z' },
      { dueDateTo: '2026-10-01T23:59:59.999Z' }
    ]) {
      const response = await request(app.getHttpServer())
        .get(`/columns/${columns[0].id}/tasks`)
        .query({ ...base, ...dateQuery })
        .set('x-test-user', String(owner.id))
        .expect(200);

      expect(response.body.total).toBe(1);
      expect(response.body.items[0].id).toBe(child.id);
    }

    const cleared = await request(app.getHttpServer())
      .get(`/columns/${columns[0].id}/tasks`)
      .query(base)
      .set('x-test-user', String(owner.id))
      .expect(200);

    expect(cleared.body.total).toBe(2);
  });

  it('обе даты, поиск, создатель, исполнитель, приоритет и тег совпадают у одной задачи', async (): Promise<void> => {
    await persist(root, {
      startDate: new Date('2026-10-01T00:00:00Z'),
      dueDate: new Date('2026-10-05T00:00:00Z'),
      priority: 'high'
    });
    const rootTag = await TaskTag.findOne({ where: { taskId: root.id } });
    const query = {
      startDateFrom: '2026-10-01T00:00:00Z',
      startDateTo: '2026-10-01T23:59:59.999Z',
      dueDateFrom: '2026-10-05T00:00:00Z',
      dueDateTo: '2026-10-05T23:59:59.999Z',
      creatorIds: owner.id,
      assigneeIds: owner.id,
      priorities: 'high',
      tagIds: rootTag!.projectTagId,
      search: 'Root',
      limit: 10
    };
    const matching = await request(app.getHttpServer())
      .get(`/columns/${columns[0].id}/tasks`)
      .query(query)
      .set('x-test-user', String(owner.id))
      .expect(200);
    const excluded = await request(app.getHttpServer())
      .get(`/columns/${columns[0].id}/tasks`)
      .query({
        ...query,
        dueDateFrom: '2026-10-06T00:00:00Z',
        dueDateTo: '2026-10-06T23:59:59.999Z'
      })
      .set('x-test-user', String(owner.id))
      .expect(200);

    expect(matching.body.total).toBe(1);
    expect(matching.body.items[0].id).toBe(root.id);
    expect(excluded.body.total).toBe(0);
  });

  it('в режиме подзадач даты одной карточки не подменяются датами родителя', async (): Promise<void> => {
    await persist(root, {
      startDate: new Date('2026-10-01T00:00:00Z'),
      dueDate: new Date('2026-10-10T00:00:00Z')
    });
    await persist(child, {
      startDate: new Date('2026-10-02T00:00:00Z'),
      dueDate: new Date('2026-10-05T00:00:00Z')
    });
    const query = {
      startDateTo: '2026-10-01T23:59:59.999Z',
      dueDateTo: '2026-10-05T23:59:59.999Z',
      includeSubtasks: true,
      flatSubtasks: true,
      limit: 10
    };

    for (const column of columns) {
      const response = await request(app.getHttpServer())
        .get(`/columns/${column.id}/tasks`)
        .query(query)
        .set('x-test-user', String(owner.id))
        .expect(200);

      expect(response.body.total).toBe(0);
    }
  });

  it('даты работают и у задач архивной доски, права проекта не меняются', async (): Promise<void> => {
    await persist(child, {
      startDate: new Date('2026-10-01T00:00:00Z'),
      dueDate: new Date('2026-10-05T00:00:00Z')
    });
    await boards.delete(board.id, owner.id);
    const query = {
      archive: 'archived',
      startDateFrom: '2026-10-01T00:00:00Z',
      dueDateTo: '2026-10-05T23:59:59.999Z',
      limit: 10
    };
    const matching = await request(app.getHttpServer())
      .get(`/columns/${columns[1].id}/tasks`)
      .query(query)
      .set('x-test-user', String(owner.id))
      .expect(200);

    expect(matching.body.total).toBe(1);
    expect(matching.body.items[0].id).toBe(child.id);
    await request(app.getHttpServer())
      .get(`/columns/${columns[1].id}/tasks`)
      .query(query)
      .set('x-test-user', String(outsider.id))
      .expect(404);
  });

  it.each(['startDate', 'dueDate'])(
    'отклоняет обратный период %s и невалидные даты',
    async (field: string): Promise<void> => {
      await request(app.getHttpServer())
        .get(`/columns/${columns[0].id}/tasks`)
        .query({
          [`${field}From`]: '2026-10-02T00:00:00Z',
          [`${field}To`]: '2026-10-01T00:00:00Z'
        })
        .set('x-test-user', String(owner.id))
        .expect(400);
      await request(app.getHttpServer())
        .get(`/columns/${columns[0].id}/tasks`)
        .query({ [`${field}From`]: '2026-02-30' })
        .set('x-test-user', String(owner.id))
        .expect(400);
    }
  );

  it('архивирует задачу с подзадачами без удаления содержимого и связей', async (): Promise<void> => {
    await request(app.getHttpServer())
      .delete(`/tasks/${root.id}`)
      .set('x-test-user', String(owner.id))
      .expect(200);
    expect(await Task.findByPk(root.id)).toBeNull();
    expect(await Task.findByPk(child.id)).toBeNull();
    const response = await request(app.getHttpServer())
      .get(`/tasks/${root.id}`)
      .set('x-test-user', String(owner.id))
      .expect(200);
    expect(response.body).toMatchObject({
      id: root.id,
      description: '<p>Original text</p>',
      customAttributeValues: { score: 123 },
      columnId: columns[0].id
    });
    expect(
      response.body.subtasks.map((item: { id: number }): number => item.id)
    ).toEqual([child.id]);
    expect(response.body.assignees).toHaveLength(1);
    expect(response.body.tags).toHaveLength(1);
    expect(response.body.attachments).toHaveLength(1);
  });

  it('разделяет активные и архивные задачи до пагинации, включая архивную подзадачу', async (): Promise<void> => {
    await tasks.delete(child.id, owner.id);
    const active = await request(app.getHttpServer())
      .get(
        `/columns/${columns[1].id}/tasks?archive=active&limit=1&flatSubtasks=true`
      )
      .set('x-test-user', String(owner.id))
      .expect(200);
    expect(active.body.total).toBe(0);
    const archived = await request(app.getHttpServer())
      .get(`/columns/${columns[1].id}/tasks?archive=archived&limit=1`)
      .set('x-test-user', String(owner.id))
      .expect(200);
    expect(archived.body.total).toBe(1);
    expect(archived.body.items[0].id).toBe(child.id);
  });

  it('фильтры создателя и поиск работают вместе с архивом', async (): Promise<void> => {
    await tasks.delete(root.id, owner.id);
    const response = await request(app.getHttpServer())
      .get(
        `/columns/${columns[0].id}/tasks?archive=archived&limit=1&creatorIds=${owner.id}&search=Root`
      )
      .set('x-test-user', String(owner.id))
      .expect(200);
    expect(response.body.total).toBe(1);
    expect(response.body.items[0].id).toBe(root.id);
  });

  it('восстанавливает задачу и подзадачи, сохраняя номера и исходные колонки', async (): Promise<void> => {
    await tasks.delete(root.id, owner.id);
    await request(app.getHttpServer())
      .post(`/tasks/${root.id}/restore`)
      .set('x-test-user', String(owner.id))
      .expect(201);
    expect(await Task.findByPk(root.id)).toMatchObject({
      taskNumber: 1,
      columnId: columns[0].id,
      order: 7
    });
    expect(await Task.findByPk(child.id)).toMatchObject({
      taskNumber: 2,
      parentTaskId: root.id,
      columnId: columns[1].id,
      order: 9
    });
  });

  it('архивирует доску и выдаёт её задачи в исходных колонках', async (): Promise<void> => {
    await request(app.getHttpServer())
      .delete(`/boards/${board.id}`)
      .set('x-test-user', String(owner.id))
      .expect(200);
    expect(await Board.findByPk(board.id)).toBeNull();
    expect(await Task.findByPk(root.id)).toBeNull();
    expect(await Task.findByPk(child.id)).toBeNull();
    const response = await request(app.getHttpServer())
      .get(`/projects/${project.id}/boards?archive=archived&limit=10`)
      .set('x-test-user', String(owner.id))
      .expect(200);
    expect(response.body.total).toBe(1);
    expect(response.body.items[0]).toMatchObject({
      id: board.id,
      tasksCount: 2
    });
    const details = await request(app.getHttpServer())
      .get(`/boards/${board.id}`)
      .set('x-test-user', String(owner.id))
      .expect(200);
    expect(details.body.columns).toHaveLength(2);
    const archived = await request(app.getHttpServer())
      .get(`/columns/${columns[0].id}/tasks?archive=archived&limit=10`)
      .set('x-test-user', String(owner.id))
      .expect(200);
    expect(archived.body.total).toBe(2);
  });

  it('возвращает доску и все задачи, включая ранее архивированные отдельно', async (): Promise<void> => {
    await boards.delete(board.id, owner.id);
    await request(app.getHttpServer())
      .post(`/boards/${board.id}/restore`)
      .set('x-test-user', String(owner.id))
      .expect(201);
    expect(await Board.findByPk(board.id)).not.toBeNull();
    expect(
      await Task.count({
        where: { columnId: columns.map(column => column.id) }
      })
    ).toBe(3);
    expect(await Task.findByPk(child.id)).toMatchObject({
      parentTaskId: root.id,
      columnId: columns[1].id
    });
  });

  it('повторный возврат доски не возвращает задачу, заново отправленную в архив', async (): Promise<void> => {
    await boards.delete(board.id, owner.id);
    await boards.restore(board.id, owner.id);
    await tasks.delete(child.id, owner.id);
    await boards.restore(board.id, owner.id);
    expect(await Task.findByPk(child.id)).toBeNull();
  });

  it('повторный возврат задачи не пишет дубликат истории и не возвращает заново архивированную подзадачу', async (): Promise<void> => {
    await tasks.delete(root.id, owner.id);
    await tasks.restore(root.id, owner.id);
    await tasks.delete(child.id, owner.id);
    const historyCount = await ActivityEvent.count();
    await tasks.restore(root.id, owner.id);
    expect(await ActivityEvent.count()).toBe(historyCount);
    expect(await Task.findByPk(child.id)).toBeNull();
  });

  it('не восстанавливает задачу отдельно от архивной доски или родителя', async (): Promise<void> => {
    await tasks.delete(root.id, owner.id);
    await request(app.getHttpServer())
      .post(`/tasks/${child.id}/restore`)
      .set('x-test-user', String(owner.id))
      .expect(400);
    await boards.delete(board.id, owner.id);
    await request(app.getHttpServer())
      .post(`/tasks/${root.id}/restore`)
      .set('x-test-user', String(owner.id))
      .expect(400);
  });

  it('не позволяет постороннему читать архив или восстанавливать записи', async (): Promise<void> => {
    await boards.delete(board.id, owner.id);
    await request(app.getHttpServer())
      .get(`/projects/${project.id}/boards?archive=archived`)
      .set('x-test-user', String(outsider.id))
      .expect(404);
    await request(app.getHttpServer())
      .get(`/tasks/${root.id}`)
      .set('x-test-user', String(outsider.id))
      .expect(404);
    await request(app.getHttpServer())
      .post(`/boards/${board.id}/restore`)
      .set('x-test-user', String(outsider.id))
      .expect(404);
    await request(app.getHttpServer())
      .post(`/tasks/${root.id}/restore`)
      .set('x-test-user', String(outsider.id))
      .expect(404);
  });

  it('не позволяет редактировать записи, пока они в архиве', async (): Promise<void> => {
    await boards.delete(board.id, owner.id);
    await request(app.getHttpServer())
      .put(`/boards/${board.id}`)
      .send({ title: 'Changed' })
      .set('x-test-user', String(owner.id))
      .expect(404);
    await request(app.getHttpServer())
      .put(`/tasks/${root.id}`)
      .send({ title: 'Changed' })
      .set('x-test-user', String(owner.id))
      .expect(404);
  });

  it('отклоняет неизвестное значение фильтра архива', async (): Promise<void> => {
    await request(app.getHttpServer())
      .get(`/projects/${project.id}/boards?archive=all`)
      .set('x-test-user', String(owner.id))
      .expect(400);
    await request(app.getHttpServer())
      .get(`/columns/${columns[0].id}/tasks?archive=all`)
      .set('x-test-user', String(owner.id))
      .expect(400);
  });

  it('откатывает архивацию доски при ошибке архивации задач', async (): Promise<void> => {
    const destroy = jest
      .spyOn(Task, 'destroy')
      .mockRejectedValueOnce(new Error('test rollback'));
    await expect(boards.delete(board.id, owner.id)).rejects.toThrow(
      'Ошибка при удалении доски'
    );
    destroy.mockRestore();
    expect(await Board.findByPk(board.id)).not.toBeNull();
    expect(await Task.findByPk(root.id)).not.toBeNull();
  });
});
