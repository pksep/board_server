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
import { IS_PUBLIC_KEY } from './public.decorator';
import { User } from '../users/model/users.model';
import { AccessTokenService } from './access-token.service';

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
    private accessTokenService: AccessTokenService
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

    // Совместимость старого режима. При SEP Auth SSE тоже требует общую сессию.
    if (!this.accessTokenService.isEnabled() && requestUrl?.includes('sse-')) {
      return true;
    }

    if (requestUrl === null) {
      this.logger.warn(
        `Auth request URL is missing; transport=${String(context.getType())}`
      );
    }

    const isLocalhost =
      this.isDev && ['localhost', '127.0.0.1'].includes(req.hostname);

    // При включённом SEP Auth board_token не должен обходить отзыв общей сессии.
    if (this.accessTokenService.isEnabled()) {
      const cookieToken = req.cookies?.[ERP_TOKEN_COOKIE];
      const bearerToken = /^Bearer\s+(\S+)$/i.exec(
        req.headers?.authorization || ''
      )?.[1];
      const accessToken = cookieToken || bearerToken;
      if (!accessToken) {
        throw new UnauthorizedException('Пользователь не авторизован');
      }
      const user = await this.accessTokenService.authenticate(accessToken);
      if (req.cookies?.[BOARD_TOKEN_COOKIE]) {
        res.clearCookie(BOARD_TOKEN_COOKIE, { path: '/' });
      }
      req.user = this.accessTokenService.toUserPayload(user);
      return true;
    }

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
            req.user = this.accessTokenService.toUserPayload(user);
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
        const user = await this.accessTokenService.authenticate(erpToken);

        // Выдаём СВОЙ board_token только в прежнем режиме.
        const newBoardToken = this.jwtService.sign(
          this.accessTokenService.toUserPayload(user),
          { expiresIn: '24h' }
        );

        res.cookie(BOARD_TOKEN_COOKIE, newBoardToken, {
          httpOnly: true,
          sameSite: 'lax',
          maxAge: 24 * 60 * 60 * 1000, // 24h
          path: '/'
        });

        req.user = this.accessTokenService.toUserPayload(user);
        return true;
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

  /** Dev-fallback пользователь */
  private async getDevFallbackUser() {
    const user = await this.userRepository.findOne({ where: { id: 1 } });
    if (user) return this.accessTokenService.toUserPayload(user);
    return { id: 1, login: 'admin', serviceNumber: '001' };
  }
}
