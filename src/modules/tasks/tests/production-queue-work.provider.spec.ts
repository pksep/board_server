import { Sequelize } from 'sequelize-typescript';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { TasksService } from '../tasks.service';
import { ProductionQueueWorkProvider } from '../production-queue-work.provider';

describe('trusted production queue work RPC', (): void => {
  const tasks: TasksService = Object.create(TasksService.prototype);
  const read = jest.fn();
  const discover = jest.fn();
  const provider = new ProductionQueueWorkProvider(
    tasks,
    Object.create(Sequelize.prototype),
    Object.create(AmqpConnection.prototype)
  );

  beforeEach((): void => {
    jest.clearAllMocks();
    Object.assign(tasks, {
      getProductionQueueWork: read,
      getProductionQueueResourceIds: discover
    });
  });

  it('allows automatic discovery without a preselected task list', async (): Promise<void> => {
    const items = [{ taskId: 7, title: 'Work', timeNormMinutes: 90 }];
    read.mockResolvedValue(items);

    expect(
      await provider.read({
        resourceId: 12,
        taskIds: [],
        includeAssigned: true
      })
    ).toEqual({ items });
    expect(read).toHaveBeenCalledWith(12, [], undefined, true);
    discover.mockResolvedValue([12]);
    expect(await provider.resources()).toEqual({ resourceIds: [12] });
  });

  it('does not combine unrestricted discovery with a user permission check', async (): Promise<void> => {
    expect(
      await provider.read({
        resourceId: 12,
        taskIds: [7],
        actorErpId: 1,
        includeAssigned: true
      })
    ).toMatchObject({ status: 400 });
    expect(await provider.read({ resourceId: 12, taskIds: [] })).toMatchObject({
      status: 400
    });
    expect(read).not.toHaveBeenCalled();
  });

  it('preserves explicit task access checks for user commands', async (): Promise<void> => {
    read.mockRejectedValue({ message: 'Forbidden', status: 403 });

    expect(
      await provider.read({ resourceId: 12, taskIds: [7], actorErpId: 1 })
    ).toEqual({ error: 'Forbidden', status: 403 });
    expect(read).toHaveBeenCalledWith(12, [7], 1, undefined);
  });
});
