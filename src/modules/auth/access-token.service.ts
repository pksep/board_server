import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import axios, { type AxiosResponse } from 'axios';
import { Op } from 'sequelize';
import { ConfigConstains } from 'src/configs/env.config';
import { User } from '../users/model/users.model';
import type { ICentralIntrospectionResponse } from './interfaces/central-introspection-response.interface';
import type { ICentralJwtHeader } from './interfaces/central-jwt-header.interface';
import type { IErpCheckResponse } from './interfaces/erp-check-response.interface';
import type { IExternalAuthUser } from './interfaces/external-auth-user.interface';
import type { IUserDataToken } from './interfaces/interface';

/** Проверяет общие access-токены и синхронизирует пользователя в Board. */
@Injectable()
export class AccessTokenService {
  constructor(
    private readonly configService: ConfigService,
    @InjectModel(User) private readonly userRepository: typeof User
  ) {}

  isEnabled(): boolean {
    return Boolean(
      this.configService.get<string>(ConfigConstains.authServiceUrl)
    );
  }

  /** Новые RS256-токены проверяются в Go, старые ERP-токены — через ERP. */
  async authenticate(token: string): Promise<User> {
    if (!token) {
      throw new UnauthorizedException('Access token required');
    }

    const externalUser = this.isCentralToken(token)
      ? await this.introspectCentral(token)
      : await this.checkLegacyErp(token);

    if (externalUser.ban) {
      throw new UnauthorizedException('User is banned');
    }

    return this.syncBoardUser(externalUser);
  }

  toUserPayload(user: User): IUserDataToken {
    return {
      id: user.id,
      erpId: user.erpId,
      login: user.login,
      serviceNumber: user.serviceNumber,
      initial: user.initial,
      role: user.role
    };
  }

  private isCentralToken(token: string): boolean {
    try {
      const header = JSON.parse(
        Buffer.from(token.split('.')[0], 'base64url').toString()
      ) as ICentralJwtHeader;
      return header.alg === 'RS256' && typeof header.kid === 'string';
    } catch {
      return false;
    }
  }

  private async introspectCentral(token: string): Promise<IExternalAuthUser> {
    const baseUrl = this.configService.get<string>(
      ConfigConstains.authServiceUrl
    );
    if (!baseUrl) {
      throw new ServiceUnavailableException('AUTH_SERVICE_URL is not configured');
    }

    let response: AxiosResponse<ICentralIntrospectionResponse>;
    try {
      response = await axios.post<ICentralIntrospectionResponse>(
        `${baseUrl.replace(/\/+$/, '')}/auth/introspect`,
        { token, audience: 'board' },
        { timeout: 3000, validateStatus: () => true, proxy: false }
      );
    } catch {
      throw new ServiceUnavailableException('Auth service unavailable');
    }

    if (response.status !== 200) {
      throw new ServiceUnavailableException('Auth service rejected introspection');
    }
    if (response.data?.active === false) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (response.data?.active !== true) {
      throw new ServiceUnavailableException('Invalid auth service response');
    }

    const user = this.parseExternalUser(response.data.user);
    if (!user) {
      throw new ServiceUnavailableException('Invalid auth service user');
    }
    return { ...user, ban: false };
  }

  private async checkLegacyErp(token: string): Promise<IExternalAuthUser> {
    const erpApiUrl = this.configService.get<string>(ConfigConstains.erpApiUrl);
    if (!erpApiUrl) {
      throw new ServiceUnavailableException('ERP_API_URL is not configured');
    }
    const normalized = erpApiUrl.replace(/\/+$/, '');
    const apiBase = normalized.endsWith('/api')
      ? normalized
      : `${normalized}/api`;

    let response: AxiosResponse<IErpCheckResponse>;
    try {
      response = await axios.post<IErpCheckResponse>(
        `${apiBase}/auth/check`,
        { token },
        { timeout: 3000, validateStatus: () => true, proxy: false }
      );
    } catch {
      throw new ServiceUnavailableException('ERP auth unavailable');
    }

    if (response.status === 401 || response.data?.ok === false) {
      throw new UnauthorizedException('Invalid or expired ERP token');
    }
    if (response.status !== 200 || response.data?.ok !== true) {
      throw new ServiceUnavailableException('Invalid ERP auth response');
    }

    const user = this.parseExternalUser(response.data.user);
    if (!user) {
      throw new ServiceUnavailableException('Invalid ERP auth user');
    }
    return user;
  }

  /** Валидирует только используемые поля недоверенного ответа. */
  private parseExternalUser(value: unknown): IExternalAuthUser | null {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const raw = value as Record<string, unknown>;
    const id = raw.id;
    if (typeof id !== 'number' && typeof id !== 'string') {
      return null;
    }
    if (typeof id === 'string' && !/^\d+$/.test(id)) {
      return null;
    }
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) {
      return null;
    }
    const role = raw.role;
    const roleName =
      typeof role === 'string'
        ? role
        : role && typeof role === 'object' &&
            typeof (role as Record<string, unknown>).name === 'string'
          ? String((role as Record<string, unknown>).name)
          : undefined;

    return {
      id,
      login: typeof raw.login === 'string' ? raw.login : undefined,
      initial: typeof raw.initial === 'string' ? raw.initial : undefined,
      tabel: typeof raw.tabel === 'string' ? raw.tabel : undefined,
      serviceNumber:
        typeof raw.serviceNumber === 'string' ? raw.serviceNumber : undefined,
      image: typeof raw.image === 'string' ? raw.image : null,
      role: roleName,
      ban: raw.ban === true
    };
  }

  /** Одно чтение Board БД; UPDATE выполняется только при изменении полей. */
  private async syncBoardUser(external: IExternalAuthUser): Promise<User> {
    const erpId = String(external.id);
    const values = {
      initial: external.initial || external.login || `User ${erpId}`,
      login: external.login || `user-${erpId}`,
      serviceNumber: external.tabel || external.serviceNumber || erpId,
      image: external.image || null,
      ban: external.ban ?? false,
      role: external.role || '-'
    };
    // До введения erpId пользователи Board связывались по табельному номеру.
    // Оба варианта ищем одним запросом, но не присваиваем чужой ненулевой erpId.
    const candidates = await this.userRepository.findAll({
      where: {
        [Op.or]: [
          { erpId },
          { erpId: null, serviceNumber: values.serviceNumber }
        ]
      },
      limit: 2
    });
    const existing =
      candidates.find(user => user.erpId === erpId) ||
      candidates.find(user => !user.erpId);

    if (existing) {
      const updates = { erpId, ...values };
      const changed = (Object.keys(updates) as (keyof typeof updates)[]).some(
        key => existing[key] !== updates[key]
      );
      if (changed) {
        await existing.update(updates);
      }
      return existing;
    }

    return this.userRepository.create({ erpId, ...values } as User);
  }
}
