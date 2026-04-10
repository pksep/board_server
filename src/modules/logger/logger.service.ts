import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

@Injectable()
export class LoggerService implements NestLoggerService {
  constructor(private readonly logger: PinoLogger) {}

  log(message: string | object, context?: string) {
    this.logger.info(
      { context },
      typeof message === 'string' ? message : JSON.stringify(message)
    );
  }

  error(error: unknown, context?: string) {
    if (error instanceof Error) {
      this.logger.error({ err: error, context }, error.message);
    } else {
      this.logger.error(
        { error, context },
        typeof error === 'string' ? error : JSON.stringify(error)
      );
    }
  }

  warn(message: string | object, context?: string) {
    this.logger.warn(
      { context },
      typeof message === 'string' ? message : JSON.stringify(message)
    );
  }

  debug(message: string | object, context?: string) {
    this.logger.debug(
      { context },
      typeof message === 'string' ? message : JSON.stringify(message)
    );
  }

  // Подробные (trace) логи
  verbose(message: string | object, context?: string) {
    this.logger.trace(
      { context },
      typeof message === 'string' ? message : JSON.stringify(message)
    );
  }
}
