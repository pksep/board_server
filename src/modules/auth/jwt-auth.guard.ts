import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/sequelize';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from './public.decorator';
import { User } from '../users/model/users.model';
import { ConfigConstains } from 'src/configs/env.config';

const { Reqi } = require('@pksep/reqi');

/** Имя cookie, которую выдаёт board-сервер */
const BOARD_TOKEN_COOKIE = 'board_token';
/** Имя cookie, которую выдаёт ERP */
const ERP_TOKEN_COOKIE = 'access_token';

type RequestWithUrl = {
  originalUrl?: unknown;
  url?: unknown;
};

export function getRequestUrl(request: RequestWithUrl): string | null {
  if (typeof request.originalUrl === 'string') return request.originalUrl;
  if (typeof request.url === 'string') return request.url;

  return null;
}

@Injectable()
export class TokenAuth implements CanActivate {
  private readonly logger = new Logger(TokenAuth.name);
  private readonly isDev = process.env.NODE_ENV !== 'production';

  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    @InjectModel(User) private userRepository: typeof User,
    private configService: ConfigService
  ) {}

  async canActivate(context: ExecutionContext) {
    // @Public() — пропускаем
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    const requestUrl = getRequestUrl(req);

    // SSE без аутентификации
    if (requestUrl?.includes('sse-')) return true;

    if (requestUrl === null) {
      this.logger.warn(
        `Auth request URL is missing; transport=${String(context.getType())}`
      );
    }

    const isLocalhost =
      this.isDev && ['localhost', '127.0.0.1'].includes(req.hostname);

    try {
      // ──────────────────────────────────────────────
      // 1. Есть board_token → верифицируем ЛОКАЛЬНО
      // ──────────────────────────────────────────────
      const boardToken = req.cookies?.[BOARD_TOKEN_COOKIE];

      if (boardToken) {
        try {
          const decoded = this.jwtService.verify(boardToken);
          const user = await this.userRepository.findOne({
            where: { id: decoded.id }
          });

          if (user && !user.ban) {
            req.user = this.toUserPayload(user);
            return true;
          }
        } catch {
          // board_token невалиден или истёк — пробуем ERP токен
          this.logger.debug('board_token invalid/expired, trying ERP token');
        }
      }

      // ──────────────────────────────────────────────
      // 2. Есть access_token (ERP) → обмен через ERP
      // ──────────────────────────────────────────────
      const erpToken = req.cookies?.[ERP_TOKEN_COOKIE];

      if (erpToken) {
        const user = await this.exchangeErpToken(erpToken);

        if (user) {
          // Выдаём СВОЙ board_token
          const newBoardToken = this.jwtService.sign(this.toUserPayload(user), {
            expiresIn: '24h'
          });

          res.cookie(BOARD_TOKEN_COOKIE, newBoardToken, {
            httpOnly: true,
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000, // 24h
            path: '/'
          });

          req.user = this.toUserPayload(user);
          return true;
        }
      }

      // ──────────────────────────────────────────────
      // 3. Нет токенов → dev fallback или 401
      // ──────────────────────────────────────────────
      if (isLocalhost) {
        req.user = await this.getDevFallbackUser();
        return true;
      }

      throw new UnauthorizedException({
        message: 'Пользователь не авторизован'
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.error(
        `Auth error: ${error instanceof Error ? error.message : String(error)}`
      );

      if (isLocalhost) {
        req.user = await this.getDevFallbackUser();
        return true;
      }

      throw new UnauthorizedException({
        message: 'Пользователь не авторизован'
      });
    }
  }

  /**
   * Обмен ERP-токена: вызываем ERP /api/auth/check,
   * получаем данные пользователя, создаём/обновляем в БД.
   */
  private async exchangeErpToken(erpToken: string): Promise<User | null> {
    const erpApiUrl = this.configService.get<string>(ConfigConstains.erpApiUrl);

    if (!erpApiUrl) {
      this.logger.warn('ERP_API_URL not set, cannot exchange token');
      return null;
    }

    try {
      const normalizedApiUrl = erpApiUrl.replace(/\/+$/, '');
      const erpApiBaseUrl = normalizedApiUrl.endsWith('/api')
        ? normalizedApiUrl
        : `${normalizedApiUrl}/api`;

      const erpApi = new Reqi(erpApiBaseUrl, {
        credentials: 'include'
      });
      const result = await erpApi.post(
        '/auth/check',
        { token: erpToken },
        { parsed: true }
      );

      if (!result.ok || !result.user) {
        this.logger.warn('ERP auth/check returned ok=false or no user');
        return null;
      }

      const erpUser = result.user;
      const erpId = String(erpUser.id);

      // Ищем или создаём пользователя
      let user = await this.userRepository.findOne({ where: { erpId } });

      if (user) {
        // Обновляем синхронизируемые поля
        let changed = false;
        const updates: Record<string, any> = {
          initial: erpUser.initial || erpUser.login,
          login: erpUser.login,
          serviceNumber: erpUser.tabel || erpUser.serviceNumber || erpId,
          image: erpUser.image || null,
          ban: erpUser.ban ?? false,
          role: erpUser.role || '-'
        };

        for (const [key, value] of Object.entries(updates)) {
          if ((user as any)[key] !== value) {
            (user as any)[key] = value;
            changed = true;
          }
        }

        if (changed) await user.save();
      } else {
        user = await this.userRepository.create({
          erpId,
          initial: erpUser.initial || erpUser.login || 'User',
          login: erpUser.login || `user-${erpId}`,
          serviceNumber: erpUser.tabel || erpUser.serviceNumber || erpId,
          image: erpUser.image || null,
          ban: erpUser.ban ?? false,
          role: erpUser.role || '-'
        } as any);

        this.logger.log(
          `Created user from ERP: erpId=${erpId}, login=${user.login}`
        );
      }

      return user;
    } catch (error) {
      this.logger.error(
        `ERP token exchange failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /** Формат req.user */
  private toUserPayload(user: User) {
    return {
      id: user.id,
      erpId: user.erpId,
      login: user.login,
      serviceNumber: user.serviceNumber,
      initial: user.initial,
      role: user.role
    };
  }

  /** Dev-fallback пользователь */
  private async getDevFallbackUser() {
    const user = await this.userRepository.findOne({ where: { id: 1 } });
    if (user) return this.toUserPayload(user);
    return { id: 1, login: 'admin', serviceNumber: '001' };
  }
}
