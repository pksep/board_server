import { UnauthorizedException } from '@nestjs/common';
import * as cookie from 'cookie';
import type { IAccessTokenRequest } from '../interfaces/access-token-request.interface';

/** An explicit Bearer is authoritative; cookies never rescue an invalid header. */
export function getAccessTokenCandidates(
  request: IAccessTokenRequest
): string[] {
  const authorization = request.headers?.authorization;

  if (authorization !== undefined) {
    const token = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1];
    if (!token || token.length > 16384) {
      throw new UnauthorizedException('Invalid Authorization header');
    }

    return [token];
  }

  const header = request.headers?.cookie;
  const tokens = new Set<string>();

  if (typeof header === 'string') {
    // Parse each pair separately: Cookie carries no Domain/Path information.
    for (const pair of header.split(';')) {
      const token = cookie.parse(pair).access_token;
      if (token) tokens.add(token);
    }
  } else {
    const token = request.cookies?.access_token;
    if (typeof token === 'string' && token) tokens.add(token);
  }

  // Bound introspection work before any network requests or identity writes.
  if (tokens.size > 8 || [...tokens].some(token => token.length > 16384)) {
    throw new UnauthorizedException('Too many or oversized access tokens');
  }

  return [...tokens];
}
