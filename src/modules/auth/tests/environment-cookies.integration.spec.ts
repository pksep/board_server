import { Controller, Get, INestApplication, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { generateKeyPairSync } from 'node:crypto';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Request } from 'express';
import cookieParser = require('cookie-parser');
import request = require('supertest');
import { AccessTokenService } from '../access-token.service';
import { TokenAuth } from '../jwt-auth.guard';
import { WsGateway } from '../../ws/ws.gateway';
import type { IBoardSocket } from '../../ws/interfaces/board-socket.interface';

/** Exercises the production guard at all three reported URL shapes. */
@Controller()
class ProtectedController {
  @Get(['projects', 'tasks/personal', 'activity/task-feed'])
  read(@Req() req: Request): { id: number; consistentCredential: boolean } {
    return {
      id: req.user.id,
      consistentCredential:
        req.cookies.access_token === req.headers.authorization?.slice(7) ||
        !req.headers.authorization
    };
  }
}

describe('Board environment cookie isolation over real HTTP and RSA JWTs', () => {
  const jwt = new JwtService();
  const keys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const user = {
    id: 7,
    erpId: '42',
    serviceNumber: '0042',
    ban: false,
    login: 'user-42',
    initial: 'User 42',
    image: null,
    role: '-',
    update: jest.fn()
  };
  const repository = { findAll: jest.fn().mockResolvedValue([user]) };
  const servers: Server[] = [];
  const apps: Record<string, INestApplication> = {};
  const services: Record<string, AccessTokenService> = {};
  const tokens: Record<string, string> = {};
  const unavailable = new Set<string>();

  /** Same signing key deliberately proves issuer isolation as well as signature. */
  const issue = (
    environment: string,
    expiresIn = 300,
    audience = 'board'
  ): string =>
    jwt.sign(
      { sub: '42', sid: `${environment}-session` },
      {
        algorithm: 'RS256',
        privateKey: keys.privateKey,
        keyid: 'test-key',
        issuer: `https://${environment}.example.test`,
        audience,
        expiresIn
      }
    );

  beforeAll(async (): Promise<void> => {
    for (const environment of ['prod', 'dev']) {
      // This stand-in models SEP Auth's introspection contract, using real JWT
      // verification. It has no sessions DB, so revocation is covered elsewhere.
      const server = createServer(async (req, res): Promise<void> => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString());
        if (unavailable.has(environment)) {
          res.statusCode = 503;
          res.end('{}');
          return;
        }
        let active = false;
        try {
          jwt.verify(body.token, {
            publicKey: keys.publicKey,
            algorithms: ['RS256'],
            issuer: `https://${environment}.example.test`,
            audience: body.audience
          });
          active = body.audience === 'board';
        } catch {
          // Mirrors active:false for invalid signature/issuer/audience/expiry.
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ active, user: { id: 42, tabel: '0042' } }));
      });
      await new Promise<void>(resolve =>
        server.listen(0, '127.0.0.1', resolve)
      );
      servers.push(server);
      const config = {
        get: (key: string): string | undefined =>
          key === 'authServiceUrl'
            ? `http://127.0.0.1:${(server.address() as AddressInfo).port}`
            : undefined
      };
      const service = new AccessTokenService(
        config as ConfigService,
        repository as never
      );
      services[environment] = service;
      const module = await Test.createTestingModule({
        controllers: [ProtectedController],
        providers: []
      }).compile();
      const app = module.createNestApplication();
      app.use(cookieParser());
      app.useGlobalGuards(
        new TokenAuth(jwt, new Reflector(), repository as never, service)
      );
      await app.init();
      apps[environment] = app;
      tokens[environment] = issue(environment);
    }
  });

  afterAll(async (): Promise<void> => {
    await Promise.all(Object.values(apps).map(app => app.close()));
    await Promise.all(
      servers.map(
        server =>
          new Promise<void>((resolve, reject) =>
            server.close(error => (error ? reject(error) : resolve()))
          )
      )
    );
  });

  it.each([
    ['dev', 'prod'],
    ['prod', 'dev']
  ])(
    'accepts only the %s identity after visiting %s, in either cookie order',
    async (local, foreign): Promise<void> => {
      for (const path of [
        '/projects',
        '/tasks/personal',
        '/activity/task-feed'
      ]) {
        for (const values of [
          [tokens[foreign], tokens[local]],
          [tokens[local], tokens[foreign]]
        ]) {
          await request(apps[local].getHttpServer())
            .get(path)
            .set(
              'Cookie',
              values.map(token => `access_token=${token}`).join('; ')
            )
            .expect(200, { id: 7, consistentCredential: true });
        }
        await request(apps[local].getHttpServer())
          .get(path)
          .set('Cookie', `access_token=${tokens[foreign]}`)
          .expect(401);
      }
    }
  );

  it.each(['dev', 'prod'])(
    'accepts a refreshed %s token next to expired cookies',
    async (local): Promise<void> => {
      const foreign = local === 'dev' ? 'prod' : 'dev';
      const expiredLocal = issue(local, -1);
      const expiredForeign = issue(foreign, -1);
      const refreshed = issue(local, 600);
      for (const values of [
        [expiredForeign, refreshed],
        [refreshed, expiredForeign],
        [expiredLocal, refreshed]
      ]) {
        await request(apps[local].getHttpServer())
          .get('/tasks/personal')
          .set(
            'Cookie',
            values.map(token => `access_token=${token}`).join('; ')
          )
          .expect(200);
      }
      await request(apps[local].getHttpServer())
        .get('/projects')
        .set(
          'Cookie',
          `access_token=${expiredLocal}; access_token=${tokens[foreign]}`
        )
        .expect(401);
    }
  );

  it('uses valid Bearer despite an invalid cookie and never falls back from invalid Bearer', async (): Promise<void> => {
    await request(apps.dev.getHttpServer())
      .get('/projects')
      .set('Cookie', `access_token=${tokens.prod}`)
      .set('Authorization', `Bearer ${tokens.dev}`)
      .expect(200, { id: 7, consistentCredential: true });
    await request(apps.dev.getHttpServer())
      .get('/projects')
      .set('Cookie', `access_token=${tokens.dev}`)
      .set('Authorization', `Bearer ${tokens.prod}`)
      .expect(401);
  });

  it('ignores a malformed cookie in either order without contacting legacy ERP', async (): Promise<void> => {
    for (const values of [
      ['invalid', tokens.dev],
      [tokens.dev, 'invalid']
    ]) {
      await request(apps.dev.getHttpServer())
        .get('/projects')
        .set('Cookie', values.map(token => `access_token=${token}`).join('; '))
        .expect(200);
    }
  });

  it('rejects wrong audience, expiry and signature with no Board identity writes', async (): Promise<void> => {
    repository.findAll.mockClear();
    for (const token of [
      issue('dev', 300, 'erp'),
      issue('dev', -1),
      `${tokens.dev.slice(0, -10)}AAAAAAAAAA`
    ]) {
      await request(apps.dev.getHttpServer())
        .get('/activity/task-feed')
        .set('Cookie', `access_token=${token}`)
        .expect(401);
    }
    expect(repository.findAll).not.toHaveBeenCalled();
  });

  it('rejects two distinct valid local sessions before synchronizing either identity', async (): Promise<void> => {
    repository.findAll.mockClear();
    await request(apps.dev.getHttpServer())
      .get('/projects')
      .set(
        'Cookie',
        `access_token=${tokens.dev}; access_token=${issue('dev', 600)}`
      )
      .expect(401);
    expect(repository.findAll).not.toHaveBeenCalled();
    await request(apps.dev.getHttpServer())
      .get('/projects')
      .set('Cookie', `access_token=${tokens.dev}; access_token=${tokens.dev}`)
      .expect(200);
  });

  it('shares selection with WebSocket and retains the selected token for revalidation', async (): Promise<void> => {
    const gateway = new WsGateway(jwt, {} as never, {} as never, services.dev);
    const socket = {
      id: 'isolation-test',
      handshake: {
        headers: {
          cookie: `access_token=${tokens.prod}; access_token=${tokens.dev}`
        }
      },
      data: {},
      join: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn()
    };
    await gateway.handleConnection(socket as IBoardSocket);
    expect(socket).toHaveProperty('user.id', 7);
    expect(socket.data).toHaveProperty('accessToken', tokens.dev);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('keeps authority outages as 503 without selecting or synchronizing a session', async (): Promise<void> => {
    repository.findAll.mockClear();
    unavailable.add('dev');
    try {
      await request(apps.dev.getHttpServer())
        .get('/projects')
        .set(
          'Cookie',
          `access_token=${tokens.prod}; access_token=${tokens.dev}`
        )
        .expect(503);
      expect(repository.findAll).not.toHaveBeenCalled();
    } finally {
      unavailable.delete('dev');
    }
  });
});
