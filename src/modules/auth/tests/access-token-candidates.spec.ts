import { UnauthorizedException } from '@nestjs/common';
import { getAccessTokenCandidates } from '../utils/access-token-candidates';

describe('Access token transport selection', () => {
  it('keeps every raw duplicate and decodes cookie values once', (): void => {
    expect(
      getAccessTokenCandidates({
        headers: {
          cookie:
            'other=private; access_token=old; access_token=new%2Etoken; access_token=old'
        },
        cookies: { access_token: 'old' }
      })
    ).toEqual(['old', 'new.token']);
  });

  it('makes explicit Bearer authoritative over cookies', (): void => {
    expect(
      getAccessTokenCandidates({
        headers: {
          authorization: 'Bearer current',
          cookie: 'access_token=stale'
        }
      })
    ).toEqual(['current']);
  });

  it.each(['Basic credentials', 'Bearer', '', 'Bearer one two'])(
    'rejects malformed explicit Authorization %p without cookie fallback',
    (authorization): void => {
      expect(() =>
        getAccessTokenCandidates({
          headers: { authorization, cookie: 'access_token=valid' }
        })
      ).toThrow(UnauthorizedException);
    }
  );

  it('uses parsed cookies only when no raw header is available', (): void => {
    expect(
      getAccessTokenCandidates({ cookies: { access_token: 'unit-test' } })
    ).toEqual(['unit-test']);
    expect(
      getAccessTokenCandidates({
        headers: { cookie: 'other=value' },
        cookies: { access_token: 'discarded' }
      })
    ).toEqual([]);
  });

  it('bounds authority calls and token size', (): void => {
    expect(() =>
      getAccessTokenCandidates({
        headers: {
          cookie: Array.from({ length: 9 }, (_, i) => `access_token=${i}`).join(
            '; '
          )
        }
      })
    ).toThrow(UnauthorizedException);
    expect(() =>
      getAccessTokenCandidates({
        headers: { authorization: `Bearer ${'a'.repeat(16385)}` }
      })
    ).toThrow(UnauthorizedException);
  });
});
