import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus
} from '@nestjs/common';
import { Request, Response } from 'express';
import { LoggerService } from '../logger.service';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const isPayloadTooLarge =
      (exception as { type?: string })?.type === 'entity.too.large' ||
      (exception as { status?: number })?.status ===
        HttpStatus.PAYLOAD_TOO_LARGE ||
      (exception as { statusCode?: number })?.statusCode ===
        HttpStatus.PAYLOAD_TOO_LARGE;

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : isPayloadTooLarge
          ? HttpStatus.PAYLOAD_TOO_LARGE
          : HttpStatus.INTERNAL_SERVER_ERROR;

    this.logger.error(
      exception instanceof Error ? exception.message : 'Unknown error',
      `HTTP ${req.method} ${req.url} reqId=${req.id}`
    );

    res.status(status).json({
      statusCode: status,
      message:
        exception instanceof HttpException
          ? exception.getResponse()
          : isPayloadTooLarge
            ? 'Размер запроса превышает 50 МБ'
            : 'Internal server error',
      reqId: req.id
    });
  }
}
