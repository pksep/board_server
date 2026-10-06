import { createHash } from 'node:crypto';
import { IBoardSessionToken } from '../interfaces/interface';

/** Возвращает отпечаток ERP-сессии без хранения исходного токена в JWT доски. */
export function getErpSessionHash(erpToken: string): string {
  return createHash('sha256').update(erpToken).digest('hex');
}

/** Проверяет привязку уже верифицированного JWT к текущей ERP-cookie. */
export function isCurrentBoardSession(
  decoded: unknown,
  erpToken: string | undefined
): decoded is IBoardSessionToken {
  // Старые JWT без привязки также требуют повторного штатного обмена через ERP.
  return (
    Boolean(erpToken) &&
    typeof decoded === 'object' &&
    decoded !== null &&
    'id' in decoded &&
    typeof decoded.id === 'number' &&
    Number.isInteger(decoded.id) &&
    decoded.id > 0 &&
    'erpTokenHash' in decoded &&
    decoded.erpTokenHash === getErpSessionHash(erpToken!)
  );
}
