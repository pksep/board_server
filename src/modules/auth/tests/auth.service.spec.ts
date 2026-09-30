import { AuthService } from '../auth.service';

describe('AuthService /auth/check', () => {
  it('проверяет SEP Auth токен при включённой общей авторизации', async () => {
    const verify = jest.fn();
    const authenticate = jest.fn().mockResolvedValue({ id: 17 });
    const user = { id: 17, login: 'ivanov', serviceNumber: '0042' };
    const service = new AuthService(
      {} as never,
      { verify } as never,
      {
        isEnabled: jest.fn().mockReturnValue(true),
        authenticate,
        toUserPayload: jest.fn().mockReturnValue(user)
      } as never
    );

    await expect(service.checkToken('central-token')).resolves.toEqual({
      ok: true,
      user
    });
    expect(authenticate).toHaveBeenCalledWith('central-token');
    expect(verify).not.toHaveBeenCalled();
  });
});
