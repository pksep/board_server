import { ConflictException, HttpException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { createHash } from 'node:crypto';
import {
  McpProjectOperation,
  McpProjectOperationStatus
} from './model/mcp-project-operation.model';
import {
  ProjectsMcpAuthContext,
  ProjectsMcpOperationResult
} from './interfaces/projects-mcp.interface';

@Injectable()
export class ProjectsMcpOperationsService {
  constructor(
    @InjectModel(McpProjectOperation)
    private operationRepository: typeof McpProjectOperation
  ) {}

  async run<T>(
    auth: ProjectsMcpAuthContext,
    toolName: string,
    idempotencyKey: string,
    input: unknown,
    operation: () => Promise<ProjectsMcpOperationResult<T>>
  ): Promise<T> {
    const requestHash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');

    const [record, created] = await this.operationRepository.findOrCreate({
      where: {
        actorUserId: auth.user.id,
        clientId: auth.clientId,
        toolName,
        idempotencyKey
      },
      defaults: {
        actorUserId: auth.user.id,
        clientId: auth.clientId,
        toolName,
        idempotencyKey,
        requestHash,
        status: McpProjectOperationStatus.Pending
      } as any
    });

    if (!created) {
      if (record.requestHash !== requestHash) {
        throw new ConflictException(
          'Этот idempotency key уже использован с другими параметрами'
        );
      }

      if (record.status === McpProjectOperationStatus.Completed) {
        return record.result as T;
      }

      if (record.status === McpProjectOperationStatus.Failed) {
        throw new HttpException(
          record.error?.message || 'Предыдущий вызов завершился ошибкой',
          record.error?.status || 409
        );
      }

      throw new ConflictException('Операция с этим ключом уже выполняется');
    }

    try {
      const { value, projectId } = await operation();
      await record.update({
        status: McpProjectOperationStatus.Completed,
        projectId: projectId ?? null,
        result: value,
        error: null
      });
      return value;
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 500;
      const message =
        error instanceof Error ? error.message : 'Неизвестная ошибка операции';

      await record.update({
        status: McpProjectOperationStatus.Failed,
        error: { status, message }
      });
      throw error;
    }
  }
}
