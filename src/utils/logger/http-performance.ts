import { randomUUID } from 'crypto';
import { IncomingMessage, ServerResponse } from 'http';
import { performance } from 'perf_hooks';
import type { Request } from 'express';

const startedAt = new WeakMap<object, number>();
const authDurations = new WeakMap<object, number>();
export const HTTP_PERFORMANCE_EXPOSED_HEADERS = [
  'X-Request-Id',
  'Server-Timing'
];

/** Использует шаблон роутера вместо URL с пользовательскими значениями. */
export function getHttpRoute(request: IncomingMessage): string {
  const route = (request as Request).route?.path;

  return typeof route === 'string' ? route : '/unmatched';
}

/** Начинает интервал Pino HTTP и возвращает безопасный идентификатор ответа. */
export function beginHttpRequest(
  request: IncomingMessage,
  response: ServerResponse
): string {
  startedAt.set(request, performance.now());

  const supplied = request.headers['x-request-id'];
  const requestId =
    typeof supplied === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(supplied)
      ? supplied
      : randomUUID();

  try {
    response.setHeader('X-Request-Id', requestId);
  } catch {
    // Диагностика не должна менять исходный ответ.
  }

  return requestId;
}

/** Измеряет полный guard, включая его обращения к другим сервисам. */
export function recordAuthDuration(request: object, started: number): void {
  authDurations.set(request, Math.max(0, performance.now() - started));
}

/** Возвращает длительность guard, если он выполнялся для этого запроса. */
export function getAuthDuration(request: object): number | undefined {
  return authDurations.get(request);
}

/** Интервал от входа в Pino HTTP; это не сумма длительностей SQL. */
export function getHttpDuration(request: object): number {
  const started = startedAt.get(request);

  return started === undefined ? 0 : Math.max(0, performance.now() - started);
}

/** Добавляет интервалы перед ответом, не затрагивая body, cookies или статус. */
export function writeHttpTiming(
  request: object,
  response: ServerResponse
): void {
  try {
    if (!response || response.headersSent || !startedAt.has(request)) return;

    const auth = getAuthDuration(request);
    const timings = [`app;dur=${getHttpDuration(request).toFixed(3)}`];

    if (auth !== undefined) timings.push(`auth;dur=${auth.toFixed(3)}`);

    response.setHeader('Server-Timing', timings.join(', '));
  } catch {
    // Например, потоковый endpoint уже начал отправку заголовков.
  }
}
