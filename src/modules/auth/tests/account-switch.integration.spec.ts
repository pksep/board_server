import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import cookieParser = require('cookie-parser');
import request = require('supertest');
import { Sequelize } from 'sequelize-typescript';
import models from '../../../configs/models';
import { ProjectsController } from '../../projects/projects.controller';
import { ProjectsService } from '../../projects/projects.service';
import { ProjectAccessService } from '../../projects/project-access.service';
import { Project } from '../../projects/model/project.model';
import { ProjectMember } from '../../projects/model/project-member.model';
import { UserFavorite } from '../../projects/model/user-favorite.model';
import { ProjectTag } from '../../tags/model/project-tag.model';
import { User } from '../../users/model/users.model';
import { UsersController } from '../../users/users.controller';
import { UsersService } from '../../users/users.service';
import { LoggerService } from '../../logger/logger.service';
import { WsGateway } from '../../ws/ws.gateway';
import { TokenAuth } from '../jwt-auth.guard';
import { AccessTokenService } from '../access-token.service';
import { getErpSessionHash } from '../utils/board-session';
import { IBoardSessionToken } from '../interfaces/interface';

// Изолируется только внешний ERP transport. JWT, HTTP, guard и доступ к БД настоящие.
const mockErpCheck = jest.fn();

jest.mock('axios', () => ({
  __esModule: true,
  default: { post: jest.fn() }
}));

const databaseUrl = process.env.BOARD_ARCHIVE_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase(
  'Account switching with real project access and JWT',
  () => {
    let app: INestApplication;
    let sequelize: Sequelize;
    let jwt: JwtService;
    let userA: User;
    let userB: User;
    let projectA: Project;
    let projectB: Project;
    let boardTokenA: string;

    /** Читает список проектов через настоящую авторизацию браузерными cookie. */
    const listProjects = (
      erpToken?: string,
      boardToken?: string
    ): request.Test => {
      const cookies = [
        erpToken ? `access_token=${erpToken}` : '',
        boardToken ? `board_token=${boardToken}` : ''
      ].filter(Boolean);

      return request(app.getHttpServer())
        .get('/projects')
        .set('Cookie', cookies);
    };

    /** Извлекает новую сессию только из ответа тестового сервера. */
    const readBoardToken = (response: request.Response): string => {
      const rawHeaders: unknown = response.headers['set-cookie'];
      const headers = Array.isArray(rawHeaders)
        ? rawHeaders.filter(
            (value): value is string => typeof value === 'string'
          )
        : typeof rawHeaders === 'string'
          ? [rawHeaders]
          : [];
      const cookie = headers.find(value => value.startsWith('board_token='));
      if (!cookie) throw new Error('Expected a renewed board session');

      return cookie.split(';')[0].slice('board_token='.length);
    };

    beforeAll(async (): Promise<void> => {
      if (
        !/^\/board_archive_test_[a-z0-9_]+$/.test(
          new URL(databaseUrl!).pathname
        )
      ) {
        throw new Error(
          'Account tests require a dedicated board_archive_test_* database'
        );
      }

      // Jest resetModules иначе создаёт второй класс при lazy require в inferAlias.
      // Закрепляем настоящие Sequelize-модели, не подменяя их запросы или данные.
      jest.doMock('../../projects/model/project-member.model', () => ({
        ProjectMember
      }));
      jest.doMock('../../projects/model/user-favorite.model', () => ({
        UserFavorite
      }));
      jest.doMock('../../tags/model/project-tag.model', () => ({ ProjectTag }));

      sequelize = new Sequelize(databaseUrl!, {
        dialect: 'postgres',
        models,
        logging: false,
        pool: { max: 2, min: 0 }
      });
      await sequelize.sync();
      jwt = new JwtService({ secret: 'isolated-account-tests-only' });
      const module = await Test.createTestingModule({
        controllers: [ProjectsController, UsersController],
        providers: [
          ProjectsService,
          ProjectAccessService,
          UsersService,
          TokenAuth,
          AccessTokenService,
          Reflector,
          { provide: LoggerService, useValue: { error: jest.fn() } },
          { provide: WsGateway, useValue: {} },
          { provide: 'CACHE_MANAGER', useValue: {} },
          ...models.map(model => ({
            provide: getModelToken(model),
            useValue: model
          })),
          { provide: Sequelize, useValue: sequelize },
          { provide: JwtService, useValue: jwt },
          {
            provide: ConfigService,
            useValue: {
              get: (key: string): string | undefined =>
                key === 'erpApiUrl'
                  ? 'http://isolated-erp.invalid/api'
                  : undefined
            }
          }
        ]
      }).compile();
      app = module.createNestApplication();
      app.use(cookieParser());
      app.useGlobalGuards(module.get(TokenAuth));
      await app.init();

      userA = await User.build()
        .set({
          erpId: '42001',
          login: 'Account QA A',
          initial: 'Account QA A',
          serviceNumber: 'account-qa-A',
          role: '-'
        })
        .save();
      userB = await User.build()
        .set({
          erpId: '42002',
          login: 'Account QA B',
          initial: 'Account QA B',
          serviceNumber: 'account-qa-B',
          role: '-'
        })
        .save();
      projectA = await Project.build()
        .set({ title: 'Only A', prefix: 'QASESSA', createdById: userA.id })
        .save();
      projectB = await Project.build()
        .set({ title: 'Only B', prefix: 'QASESSB', createdById: userB.id })
        .save();
    });

    beforeEach((): void => {
      jest.mocked(axios.post).mockImplementation(async (path, body) => ({
        status: 200,
        data: await mockErpCheck(path, body)
      }));
      mockErpCheck.mockReset();
      mockErpCheck.mockImplementation(
        (_path: string, body: { token: string }) => {
          const user = body.token.startsWith('erp-A')
            ? userA
            : body.token === 'erp-B'
              ? userB
              : null;

          return Promise.resolve(
            user
              ? {
                  ok: true,
                  user: {
                    id: user.erpId,
                    login: user.login,
                    initial: user.initial,
                    tabel: user.serviceNumber,
                    role: user.role,
                    ban: user.ban
                  }
                }
              : { ok: false }
          );
        }
      );
      boardTokenA = jwt.sign({
        id: userA.id,
        erpTokenHash: getErpSessionHash('erp-A')
      });
    });

    afterAll(async (): Promise<void> => {
      await app?.close();
      await sequelize?.close();
    });

    it('returns only current projects for A → B → A with stale board cookies', async (): Promise<void> => {
      const firstA = await listProjects('erp-A').expect(200);
      expect(firstA.body.map((project: { id: number }) => project.id)).toEqual([
        projectA.id
      ]);
      const firstTokenA = readBoardToken(firstA);

      const responseB = await listProjects('erp-B', firstTokenA).expect(200);
      expect(
        responseB.body.map((project: { id: number }) => project.id)
      ).toEqual([projectB.id]);
      const tokenB = readBoardToken(responseB);

      const returnedA = await listProjects('erp-A', tokenB).expect(200);
      expect(
        returnedA.body.map((project: { id: number }) => project.id)
      ).toEqual([projectA.id]);
      const decoded = jwt.verify<IBoardSessionToken>(readBoardToken(returnedA));
      expect(decoded.erpTokenHash).toBe(getErpSessionHash('erp-A'));
      expect(decoded.erpTokenHash).not.toBe('erp-A');
    });

    it('keeps the local fast path for an unchanged ERP session', async (): Promise<void> => {
      const response = await listProjects('erp-A', boardTokenA).expect(200);

      expect(
        response.body.map((project: { id: number }) => project.id)
      ).toEqual([projectA.id]);
      expect(mockErpCheck).not.toHaveBeenCalled();
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('migrates legacy unbound board tokens using current ERP identity', async (): Promise<void> => {
      const legacy = jwt.sign({ id: userA.id });
      const response = await listProjects('erp-B', legacy).expect(200);

      expect(
        response.body.map((project: { id: number }) => project.id)
      ).toEqual([projectB.id]);
      expect(jwt.verify<IBoardSessionToken>(readBoardToken(response)).id).toBe(
        userB.id
      );
    });

    it('does not revive access after logout when only a board cookie remains', async (): Promise<void> => {
      await listProjects(undefined, boardTokenA).expect(401);
      expect(mockErpCheck).not.toHaveBeenCalled();
    });

    it('does not fall back to old identity or a dev user after ERP rejects new login', async (): Promise<void> => {
      await listProjects('invalid-erp', boardTokenA).expect(401);
      expect(mockErpCheck).toHaveBeenCalledTimes(1);
    });

    it('renews binding after ERP token refresh without changing the user', async (): Promise<void> => {
      const response = await listProjects(
        'erp-A-refreshed',
        boardTokenA
      ).expect(200);

      expect(
        response.body.map((project: { id: number }) => project.id)
      ).toEqual([projectA.id]);
      expect(
        jwt.verify<IBoardSessionToken>(readBoardToken(response)).erpTokenHash
      ).toBe(getErpSessionHash('erp-A-refreshed'));
    });

    it('cannot open the previous user’s project with a stale board cookie', async (): Promise<void> => {
      await request(app.getHttpServer())
        .get(`/projects/${projectA.id}`)
        .set('Cookie', ['access_token=erp-B', `board_token=${boardTokenA}`])
        .expect(404);
    });

    it('does not authorize a blocked ERP user', async (): Promise<void> => {
      mockErpCheck.mockResolvedValue({
        ok: true,
        user: {
          id: '42003',
          login: 'blocked',
          tabel: 'account-qa-blocked',
          ban: true
        }
      });

      await listProjects('erp-blocked', boardTokenA).expect(401);
    });

    /** Создаёт старую запись без ERP-привязки в собственной тестовой базе. */
    const createLegacyOwner = async (
      suffix: string,
      ban = false,
      serviceNumber = `00-legacy-${suffix}`
    ): Promise<{ user: User; project: Project }> => {
      const user = await User.build()
        .set({
          login: `Legacy ${suffix}`,
          initial: `Legacy ${suffix}`,
          serviceNumber,
          role: '-',
          ban
        })
        .save();
      const project = await Project.build()
        .set({
          title: `Legacy ${suffix}`,
          prefix: `QL${suffix}`,
          createdById: user.id
        })
        .save();

      return { user, project };
    };

    it('links an existing legacy owner and loads projects and users without a duplicate', async (): Promise<void> => {
      const { user, project } = await createLegacyOwner('RESTORE');
      const usersBefore = await User.count();
      mockErpCheck.mockResolvedValue({
        ok: true,
        user: {
          id: '42004',
          login: 'Verified legacy owner',
          initial: 'Verified legacy owner',
          tabel: user.serviceNumber,
          role: '-',
          ban: false
        }
      });

      const response = await listProjects('erp-legacy-cookie').expect(200);
      const boardToken = readBoardToken(response);
      expect(response.body.map((item: { id: number }) => item.id)).toEqual([
        project.id
      ]);
      expect(jwt.verify<IBoardSessionToken>(boardToken).id).toBe(user.id);
      const usersResponse = await request(app.getHttpServer())
        .get('/users/list')
        .set('Cookie', [
          'access_token=erp-legacy-cookie',
          `board_token=${boardToken}`
        ])
        .expect(200);

      expect(usersResponse.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: user.id,
            login: 'Verified legacy owner'
          })
        ])
      );
      expect(await User.count()).toBe(usersBefore);
      expect((await User.findByPk(user.id))?.erpId).toBe('42004');
      expect((await Project.findByPk(project.id))?.createdById).toBe(user.id);
      expect(mockErpCheck).toHaveBeenCalledTimes(1);
    });

    it('does not claim a legacy owner using an inferred ERP number', async (): Promise<void> => {
      const { user } = await createLegacyOwner('INFERRED', false, '42005');
      mockErpCheck.mockResolvedValue({
        ok: true,
        user: {
          id: user.serviceNumber,
          login: 'Different identity',
          ban: false
        }
      });

      await listProjects('erp-no-tabel').expect(401);

      expect((await User.findByPk(user.id))?.erpId).toBeNull();
    });

    it('does not relink a number already owned by another ERP account', async (): Promise<void> => {
      mockErpCheck.mockResolvedValue({
        ok: true,
        user: {
          id: '42006',
          login: 'Different identity',
          tabel: userB.serviceNumber,
          ban: false
        }
      });

      await listProjects('erp-number-conflict-cookie').expect(401);

      expect((await User.findByPk(userB.id))?.erpId).toBe('42002');
      expect((await Project.findByPk(projectB.id))?.createdById).toBe(userB.id);
    });

    it.each([
      ['LOCALBAN', true, false],
      ['ERPBAN', false, true]
    ])(
      'does not link a blocked legacy account: %s',
      async (suffix, localBan, erpBan): Promise<void> => {
        const { user } = await createLegacyOwner(suffix, localBan);
        mockErpCheck.mockResolvedValue({
          ok: true,
          user: {
            id: localBan ? '42007' : '42008',
            login: 'Blocked legacy account',
            tabel: user.serviceNumber,
            ban: erpBan
          }
        });

        await listProjects(`erp-blocked-${suffix}`).expect(401);

        const persisted = await User.findByPk(user.id);
        expect(persisted?.erpId).toBeNull();
        expect(persisted?.ban).toBe(localBan);
      }
    );

    it('loads concurrent projects and users requests with one legacy identity', async (): Promise<void> => {
      const { user, project } = await createLegacyOwner('PARALLEL');
      const usersBefore = await User.count();
      mockErpCheck.mockResolvedValue({
        ok: true,
        user: {
          id: '42009',
          login: 'Parallel legacy owner',
          tabel: user.serviceNumber,
          role: '-',
          ban: false
        }
      });

      const [projectsResponse, usersResponse] = await Promise.all([
        listProjects('erp-legacy-parallel-cookie').expect(200),
        request(app.getHttpServer())
          .get('/users/list')
          .set('Cookie', ['access_token=erp-legacy-parallel-cookie'])
          .expect(200)
      ]);

      expect(
        projectsResponse.body.map((item: { id: number }) => item.id)
      ).toEqual([project.id]);
      expect(
        jwt.verify<IBoardSessionToken>(readBoardToken(usersResponse)).id
      ).toBe(user.id);
      expect(
        jwt.verify<IBoardSessionToken>(readBoardToken(projectsResponse)).id
      ).toBe(user.id);
      expect(await User.count()).toBe(usersBefore);
    });

    it('cannot race two different ERP identities into the same legacy owner', async (): Promise<void> => {
      const { user } = await createLegacyOwner('CONFLICT');
      mockErpCheck.mockImplementation(
        (_path: string, body: { token: string }) =>
          Promise.resolve({
            ok: true,
            user: {
              id: body.token === 'erp-claim-first' ? '42010' : '42011',
              login: 'Concurrent identity',
              tabel: user.serviceNumber,
              role: '-',
              ban: false
            }
          })
      );

      const responses = await Promise.all([
        listProjects('erp-claim-first'),
        listProjects('erp-claim-second')
      ]);

      expect(responses.map(response => response.status).sort()).toEqual([
        200, 401
      ]);
      const persisted = await User.findByPk(user.id);
      expect(['42010', '42011']).toContain(persisted?.erpId);
      expect(
        await User.count({ where: { serviceNumber: user.serviceNumber } })
      ).toBe(1);
    });
  }
);
