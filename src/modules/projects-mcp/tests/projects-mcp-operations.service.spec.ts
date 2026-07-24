import { ConflictException } from '@nestjs/common';
import { ProjectsMcpOperationsService } from '../projects-mcp-operations.service';
import { McpProjectOperationStatus } from '../model/mcp-project-operation.model';
import { ProjectsMcpAuthContext } from '../interfaces/projects-mcp.interface';
import { createHash } from 'node:crypto';

describe('ProjectsMcpOperationsService', () => {
  const operationRepository = {
    findOrCreate: jest.fn()
  };
  const service = new ProjectsMcpOperationsService(operationRepository as any);
  const auth: ProjectsMcpAuthContext = {
    user: {
      id: 7,
      login: 'DA',
      serviceNumber: '007'
    },
    clientId: 'codex',
    audience: 'board-projects-mcp',
    scopes: new Set(['projects:create'])
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('фиксирует результат первой операции', async () => {
    const record = {
      update: jest.fn()
    };
    operationRepository.findOrCreate.mockResolvedValue([record, true]);

    await expect(
      service.run(
        auth,
        'projects_create',
        'unique-key',
        { title: 'A' },
        async () => ({
          value: { id: 42 },
          projectId: 42
        })
      )
    ).resolves.toEqual({ id: 42 });

    expect(record.update).toHaveBeenCalledWith({
      status: McpProjectOperationStatus.Completed,
      projectId: 42,
      result: { id: 42 },
      error: null
    });
  });

  it('возвращает сохранённый результат повторного вызова', async () => {
    const input = { title: 'A' };
    const requestHash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    operationRepository.findOrCreate.mockResolvedValue([
      {
        requestHash,
        status: McpProjectOperationStatus.Completed,
        result: { id: 42 }
      },
      false
    ]);
    const operation = jest.fn();

    await expect(
      service.run(auth, 'projects_create', 'unique-key', input, operation)
    ).resolves.toEqual({ id: 42 });
    expect(operation).not.toHaveBeenCalled();
  });

  it('отклоняет повторное использование ключа с другими параметрами', async () => {
    operationRepository.findOrCreate.mockResolvedValue([
      {
        requestHash: 'different',
        status: McpProjectOperationStatus.Completed
      },
      false
    ]);

    await expect(
      service.run(
        auth,
        'projects_create',
        'unique-key',
        { title: 'B' },
        jest.fn()
      )
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
