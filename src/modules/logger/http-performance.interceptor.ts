import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { writeHttpTiming } from '../../utils/logger/http-performance';

/** Завершает app-интервал после handler, до сериализации Express. */
@Injectable()
export class HttpPerformanceInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    return next.handle().pipe(
      tap({
        next: () => writeHttpTiming(request, response),
        error: () => writeHttpTiming(request, response)
      })
    );
  }
}
