import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IUserDataToken } from './interfaces/interface';
import { LoggerService } from '../logger/logger.service';

@Injectable()
export class AuthService {
  constructor(
    private logger: LoggerService,
    private jwtService: JwtService
  ) {}

  /**
   * Проверить валидность JWT-токена.
   * Используется для внутренних проверок (WebSocket auth и т.п.)
   */
  async checkToken(
    token: string
  ): Promise<{ ok: boolean; user: IUserDataToken }> {
    try {
      const decoded = this.jwtService.verify(token);
      if (!decoded) {
        throw new UnauthorizedException('Invalid or expired token');
      }

      return {
        ok: true,
        user: decoded
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
