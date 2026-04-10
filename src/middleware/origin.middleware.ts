import { HttpException, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import configFactory from 'src/configs/env.config';

export class OriginMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    try {
      const config = configFactory();

      const allowedOrigins =
        [config.allowedOrigin, config.erpClientOfflineHost]
          .filter(Boolean)
          .join(',')
          .split(',')
          .map(origin => this.normalizeOrigin(origin.trim()))
          .filter(Boolean) ?? [];

      if (
        allowedOrigins.includes('*') ||
        process.env.APPLICATION_TYPE === 'test'
      ) {
        return next();
      }

      const requestOrigin = req.headers.origin || req.headers.referer;

      if (
        process.env.APPLICATION_TYPE === 'test' ||
        (requestOrigin && allowedOrigins.some(o => requestOrigin.startsWith(o)))
      ) {
        return next();
      }

      return res.status(403).send({
        message: 'Forbidden'
      });
    } catch (error) {
      console.error(error);
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        error instanceof Error ? error.message : 'Forbidden',
        500
      );
    }
  }

  private normalizeOrigin(origin?: string): string | null {
    if (!origin) return null;

    if (origin === '*') return origin;

    // если нет http:// или https:// — добавляем http://
    if (!/^https?:\/\//i.test(origin)) {
      origin = `http://${origin}`;
    }

    try {
      return new URL(origin).origin; // вернёт только протокол+домен+порт
    } catch {
      return null;
    }
  }
}
