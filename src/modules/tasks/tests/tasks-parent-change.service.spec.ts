import { HttpException, HttpStatus } from '@nestjs/common';
import { TasksService } from '../tasks.service';

interface TestContextOptions {
  childTask?: { id: number } | null;
  parentBoardId?: number;
}

/** Создаёт изолированный TasksService для сценариев смены родителя. */
const createContext = (options: TestContextOptions = {}) => {
  const transaction = {
    commit: jest.fn(),
    rollback: jest.fn(),
    LOCK: { UPDATE: 'UPDATE' }
  };
  const task = {
    id: 42,
    taskNumber: 12,
    title: 'Листовая задача',
    description: '',
    priority: '',
    dueDate: null,
    approvalStatus: '',
    columnId: 10,
    parentTaskId: null as number | null,
    order: 2,
    save: jest.fn().mockResolvedValue(undefined)
  };
  const parentTask = {
    id: 8,
    taskNumber: 4,
    title: 'Новый родитель',
    description: '',
    priority: '',
    dueDate: null,
    approvalStatus: '',
    columnId: 11,
    parentTaskId: null,
    order: 1
  };
  const remainingTask = {
    id: 43,
    columnId: 10,
    parentTaskId: null,
    order: 3,
    update: jest.fn().mockResolvedValue(undefined)
  };
  const taskRepository = {
    findByPk: jest.fn(async (id: number) =>
      id === parentTask.id ? parentTask : task
    ),
    findOne: jest.fn().mockResolvedValue(options.childTask ?? null),
    findAll: jest.fn().mockResolvedValue([remainingTask])
  };
  const columnRepository = {
    findByPk: jest.fn(async (id: number, query: any) => {
      if (query?.include) {
        return { id, board: { projectId: 30 } };
      }
      return {
        id,
        boardId: id === parentTask.columnId ? (options.parentBoardId ?? 20) : 20
      };
    })
  };
  const boardRepository = {
    findByPk: jest.fn().mockResolvedValue({ id: 20, projectId: 30 })
  };
  const activityEvents = {
    buildChanges: jest.fn().mockReturnValue([]),
    create: jest.fn()
  };
  const wsGateway = { emitTaskUpdated: jest.fn() };
  const service = new TasksService(
    taskRepository as any,
    { findAll: jest.fn() } as any,
    { findAll: jest.fn() } as any,
    {} as any,
    {} as any,
    columnRepository as any,
    boardRepository as any,
    { transaction: jest.fn().mockResolvedValue(transaction) } as any,
    wsGateway as any,
    {} as any,
    { assertCanRead: jest.fn() } as any,
    activityEvents as any
  );

  return {
    parentTask,
    remainingTask,
    service,
    task,
    taskRepository,
    transaction
  };
};

describe('TasksService.update parent task', () => {
  it('прикрепляет листовую корневую задачу к задаче той же доски', async () => {
    const context = createContext();

    await context.service.update(
      context.task.id,
      { parentTaskId: context.parentTask.id },
      7
    );

    expect(context.task.parentTaskId).toBe(context.parentTask.id);
    expect(context.task.order).toBe(0);
    expect(context.remainingTask.update).toHaveBeenCalledWith(
      { order: 0 },
      { transaction: context.transaction }
    );
    expect(context.task.save).toHaveBeenCalledWith({
      transaction: context.transaction
    });
    expect(context.transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('запрещает менять родителя задачи с подзадачами', async () => {
    const context = createContext({ childTask: { id: 99 } });

    await expect(
      context.service.update(
        context.task.id,
        { parentTaskId: context.parentTask.id },
        7
      )
    ).rejects.toMatchObject<HttpException>({
      status: HttpStatus.BAD_REQUEST
    });

    expect(context.task.save).not.toHaveBeenCalled();
    expect(context.transaction.rollback).toHaveBeenCalledTimes(1);
  });

  it('запрещает прикреплять задачу к другой доске', async () => {
    const context = createContext({ parentBoardId: 21 });

    await expect(
      context.service.update(
        context.task.id,
        { parentTaskId: context.parentTask.id },
        7
      )
    ).rejects.toMatchObject<HttpException>({
      status: HttpStatus.BAD_REQUEST
    });

    expect(context.task.save).not.toHaveBeenCalled();
    expect(context.transaction.rollback).toHaveBeenCalledTimes(1);
  });
});
