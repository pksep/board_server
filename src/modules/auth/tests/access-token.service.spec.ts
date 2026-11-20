import axios from 'axios';
import {
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import { AccessTokenService } from '../access-token.service';
import { Op } from 'sequelize';

const centralToken = `${Buffer.from(
  JSON.stringify({ alg: 'RS256', kid: 'test-key' })
).toString('base64url')}.payload.signature`;

describe('AccessTokenService', () => {
  const boardUser = {
    id: 17,
    erpId: '42',
    login: 'ivanov',
    initial: 'Иванов И.И.',
    serviceNumber: '0042',
    image: null,
    ban: false,
    role: 'Engineer',
    update: jest.fn()
  };
  const repository = {
    findAll: jest.fn().mockResolvedValue([boardUser]),
    create: jest.fn()
  };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'authServiceUrl') return 'http://sep-auth:8080/';
      if (key === 'erpApiUrl') return 'http://erp:5000';
      return undefined;
    })
  };
  const service = new AccessTokenService(config as never, repository as never);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    repository.findAll.mockResolvedValue([boardUser]);
  });

  it('проверяет Go-токен с audience board и возвращает локального пользователя', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: {
        active: true,
        user: {
          id: 42,
          login: 'ivanov',
          initial: 'Иванов И.И.',
          tabel: '0042',
          image: '',
          role: { id: 2, name: 'Engineer' }
        }
      }
    } as never);

    await expect(service.authenticate(centralToken)).resolves.toBe(boardUser);

    expect(post).toHaveBeenCalledWith(
      'http://sep-auth:8080/auth/introspect',
      { token: centralToken, audience: 'board' },
      expect.objectContaining({ timeout: 3000 })
    );
    expect(repository.findAll).toHaveBeenCalledWith({
      where: {
        [Op.or]: [{ erpId: '42' }, { serviceNumber: '0042' }]
      },
      limit: 2
    });
    expect(boardUser.update).not.toHaveBeenCalled();
  });

  it('отклоняет отозванную сессию без запроса в Board БД', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: { active: false }
    } as never);

    await expect(service.authenticate(centralToken)).rejects.toThrow(
      UnauthorizedException
    );
    expect(repository.findAll).not.toHaveBeenCalled();
  });

  it('не переходит на ERP при недоступности SEP Auth', async () => {
    const post = jest
      .spyOn(axios, 'post')
      .mockRejectedValue(new Error('offline'));

    await expect(service.authenticate(centralToken)).rejects.toThrow(
      ServiceUnavailableException
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('не считает ошибку SEP Auth недействительным токеном', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      status: 503,
      data: { error: 'database unavailable' }
    } as never);

    await expect(service.authenticate(centralToken)).rejects.toThrow(
      ServiceUnavailableException
    );
    expect(repository.findAll).not.toHaveBeenCalled();
  });

  it.each([200, 201, 202, 299])(
    'проверяет старый ERP-токен при успешном ответе ERP %i',
    async (status): Promise<void> => {
      const post = jest.spyOn(axios, 'post').mockResolvedValue({
        status,
        data: {
          ok: true,
          user: {
            id: 42,
            login: 'ivanov',
            initial: 'Иванов И.И.',
            tabel: '0042',
            role: 'Engineer'
          }
        }
      } as never);

      await expect(service.authenticate('legacy-erp-token')).resolves.toBe(
        boardUser
      );
      expect(post).toHaveBeenCalledWith(
        'http://erp:5000/api/auth/check',
        { token: 'legacy-erp-token' },
        expect.objectContaining({ timeout: 3000 })
      );
    }
  );

  it.each([199, 300, 302, 403, 500, 503])(
    'отклоняет ответ ERP %i даже при ok: true',
    async (status): Promise<void> => {
      jest.spyOn(axios, 'post').mockResolvedValue({
        status,
        data: { ok: true, user: { id: 42, tabel: '0042' } }
      });

      await expect(service.authenticate('legacy-erp-token')).rejects.toThrow(
        ServiceUnavailableException
      );
      expect(repository.findAll).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    }
  );

  it.each([
    {
      name: 'пустое тело',
      status: 201,
      data: null,
      error: ServiceUnavailableException
    },
    {
      name: 'нет подтверждения',
      status: 201,
      data: { user: { id: 42 } },
      error: ServiceUnavailableException
    },
    {
      name: 'нет пользователя',
      status: 201,
      data: { ok: true },
      error: ServiceUnavailableException
    },
    {
      name: 'неверный ID',
      status: 201,
      data: { ok: true, user: { id: 'invalid' } },
      error: ServiceUnavailableException
    },
    {
      name: 'отказ ERP',
      status: 201,
      data: { ok: false },
      error: UnauthorizedException
    },
    {
      name: 'пользователь заблокирован',
      status: 201,
      data: { ok: true, user: { id: 42, ban: true } },
      error: UnauthorizedException
    },
    {
      name: 'нет тела ответа 204',
      status: 204,
      data: undefined,
      error: ServiceUnavailableException
    }
  ])(
    'отклоняет ответ $status: $name',
    async ({ status, data, error }): Promise<void> => {
      jest.spyOn(axios, 'post').mockResolvedValue({ status, data });

      await expect(service.authenticate('legacy-erp-token')).rejects.toThrow(
        error
      );
      expect(repository.findAll).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    }
  );

  it('отклоняет старый ERP-токен при ответе 401', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      status: 401,
      data: { message: 'Unauthorized' }
    } as never);

    await expect(service.authenticate('expired-erp-token')).rejects.toThrow(
      UnauthorizedException
    );
    expect(repository.findAll).not.toHaveBeenCalled();
  });

  it('привязывает существующего пользователя без erpId по табельному номеру', async () => {
    const legacyBoardUser = {
      ...boardUser,
      erpId: null,
      update: jest.fn().mockResolvedValue(undefined)
    };
    repository.findAll.mockResolvedValue([legacyBoardUser]);
    jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: {
        active: true,
        user: {
          id: 42,
          login: 'ivanov',
          initial: 'Иванов И.И.',
          tabel: '0042',
          role: { name: 'Engineer' }
        }
      }
    } as never);

    await expect(service.authenticate(centralToken)).resolves.toBe(
      legacyBoardUser
    );
    expect(legacyBoardUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ erpId: '42' })
    );
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('не объединяет разные записи при конфликте двух идентификаторов', async () => {
    repository.findAll.mockResolvedValue([
      { ...boardUser, id: 18, erpId: 'old', update: jest.fn() },
      { ...boardUser, serviceNumber: 'old-number', update: jest.fn() }
    ]);
    jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: {
        active: true,
        user: { id: 42, login: 'ivanov', tabel: '0042' }
      }
    } as never);

    await expect(service.authenticate(centralToken)).rejects.toThrow(
      ConflictException
    );
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('перепривязывает прежний erpId у пользователя с тем же табельным номером', async () => {
    const user = {
      ...boardUser,
      erpId: 'old-erp-id',
      update: jest.fn()
    };
    repository.findAll.mockResolvedValue([user]);
    jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: {
        active: true,
        user: {
          id: 42,
          login: 'ivanov',
          initial: 'Иванов И.И.',
          tabel: '0042',
          role: { name: 'Engineer' }
        }
      }
    } as never);

    await expect(service.authenticate(centralToken)).resolves.toBe(user);
    expect(user.update).toHaveBeenCalledWith(
      expect.objectContaining({ erpId: '42' })
    );
  });
});
