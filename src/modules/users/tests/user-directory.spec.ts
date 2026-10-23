import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import { UserDirectoryService } from '../user-directory.service';
import { UserSyncConsumer } from '../user-sync.consumer';

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));

describe('ERP directory backfill before listing Board users', () => {
  const sync = { synchronizeUser: jest.fn() };
  const request = { cookies: { access_token: 'erp-session' } };
  const employee = { id: 42, tabel: '0042', login: 'Иванов И.И.' };
  let service: UserDirectoryService;

  beforeEach(async (): Promise<void> => {
    jest.clearAllMocks();
    sync.synchronizeUser.mockResolvedValue(undefined);
    jest.mocked(axios.get).mockResolvedValue({ status: 200, data: [employee] });
    const module = await Test.createTestingModule({
      providers: [
        UserDirectoryService,
        {
          provide: ConfigService,
          useValue: new ConfigService({ erpApiUrl: 'http://erp.invalid/api/' })
        },
        { provide: UserSyncConsumer, useValue: sync }
      ]
    }).compile();
    service = module.get(UserDirectoryService);
  });

  it('uses the authenticated canonical ERP directory and fills only missing users', async (): Promise<void> => {
    await service.ensureMissingUsers(request);

    expect(axios.get).toHaveBeenCalledWith(
      'http://erp.invalid/api/users/list/true/false',
      {
        headers: {
          Cookie: 'access_token=erp-session',
          compress: 'no-compress'
        },
        timeout: 5000,
        maxRedirects: 0,
        proxy: false
      }
    );
    expect(sync.synchronizeUser).toHaveBeenCalledWith(employee, true);
  });

  it('accepts a Bearer session and coalesces concurrent and recent reads', async (): Promise<void> => {
    await Promise.all([
      service.ensureMissingUsers({
        headers: { authorization: 'Bearer erp-bearer' }
      }),
      service.ensureMissingUsers({
        headers: { authorization: 'Bearer erp-bearer' }
      })
    ]);
    await service.ensureMissingUsers(request);

    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(jest.mocked(axios.get).mock.calls[0][1]?.headers).toEqual({
      Cookie: 'access_token=erp-bearer',
      compress: 'no-compress'
    });
    expect(sync.synchronizeUser).toHaveBeenCalledTimes(1);
  });

  it('refreshes the directory after the successful snapshot expires', async (): Promise<void> => {
    await service.ensureMissingUsers(request);
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60001);

    try {
      await service.ensureMissingUsers(request);
      expect(axios.get).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('does not fetch without an ERP session', async (): Promise<void> => {
    await service.ensureMissingUsers({});
    await service.ensureMissingUsers({
      headers: { authorization: 'Basic something' }
    });

    expect(axios.get).not.toHaveBeenCalled();
    expect(sync.synchronizeUser).not.toHaveBeenCalled();
  });

  it('does not copy roles or import blocked users from an unexpected response', async (): Promise<void> => {
    jest.mocked(axios.get).mockResolvedValue({
      data: [
        { ...employee, role: 'admin' },
        { id: 43, tabel: '0043', login: 'Blocked', ban: true }
      ]
    });
    await service.ensureMissingUsers(request);

    expect(sync.synchronizeUser).toHaveBeenCalledTimes(1);
    expect(sync.synchronizeUser).toHaveBeenCalledWith(employee, true);
  });

  it.each([
    { error: 'not a directory' },
    [employee, { ...employee, id: 43 }],
    [employee, { ...employee, tabel: '0043' }],
    [employee, { id: 43, login: 'No service number' }],
    [employee, { ...employee, id: 0, tabel: '0043' }]
  ])(
    'rejects a malformed or ambiguous snapshot before writing anything: %j',
    async (data): Promise<void> => {
      jest.mocked(axios.get).mockResolvedValue({ data });
      await service.ensureMissingUsers(request);

      expect(sync.synchronizeUser).not.toHaveBeenCalled();
    }
  );

  it('keeps the stored list available on ERP failure and retries on the next read', async (): Promise<void> => {
    jest.mocked(axios.get).mockRejectedValueOnce(new Error('unavailable'));
    await expect(service.ensureMissingUsers(request)).resolves.toBeUndefined();
    await service.ensureMissingUsers(request);

    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(sync.synchronizeUser).toHaveBeenCalledTimes(1);
  });

  it('does not mark a failed database update as a refreshed directory', async (): Promise<void> => {
    sync.synchronizeUser.mockRejectedValueOnce(
      new Error('database unavailable')
    );
    await service.ensureMissingUsers(request);
    await service.ensureMissingUsers(request);

    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(sync.synchronizeUser).toHaveBeenCalledTimes(2);
  });
});
