import { HttpStatus } from '@nestjs/common';
import { ProjectsService } from './projects.service';

describe('ProjectsService project order', () => {
  const transaction = {
    LOCK: { UPDATE: 'UPDATE' },
    commit: jest.fn(),
    rollback: jest.fn()
  };
  const projectRepository = {
    findAll: jest.fn()
  };
  const memberRepository = {
    findAll: jest.fn(),
    update: jest.fn()
  };
  const favoriteRepository = {};
  const sequelize = {
    transaction: jest.fn().mockResolvedValue(transaction)
  };
  const service = new ProjectsService(
    projectRepository as any,
    memberRepository as any,
    favoriteRepository as any,
    sequelize as any,
    {} as any
  );

  beforeEach(() => {
    jest.clearAllMocks();
    sequelize.transaction.mockResolvedValue(transaction);
  });

  it('возвращает проекты в персональном порядке участника', async () => {
    memberRepository.findAll.mockResolvedValue([
      { projectId: 1, order: 1 },
      { projectId: 2, order: 0 }
    ]);
    projectRepository.findAll.mockResolvedValue([
      { id: 1, createdAt: new Date('2026-08-19T10:00:00Z') },
      { id: 2, createdAt: new Date('2026-08-18T10:00:00Z') }
    ]);

    const result = await service.getAll(42);

    expect(result.map(project => project.id)).toEqual([2, 1]);
  });

  it('сохраняет полный порядок только для текущего пользователя', async () => {
    memberRepository.findAll.mockResolvedValue([
      { projectId: 1 },
      { projectId: 2 }
    ]);
    memberRepository.update.mockResolvedValue([1]);

    await expect(service.reorder([2, 1], 42)).resolves.toBeUndefined();

    expect(memberRepository.update).toHaveBeenNthCalledWith(
      1,
      { order: 0 },
      { where: { projectId: 2, userId: 42 }, transaction }
    );
    expect(memberRepository.update).toHaveBeenNthCalledWith(
      2,
      { order: 1 },
      { where: { projectId: 1, userId: 42 }, transaction }
    );
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('отклоняет неполный порядок и не меняет данные', async () => {
    memberRepository.findAll.mockResolvedValue([
      { projectId: 1 },
      { projectId: 2 }
    ]);

    await expect(service.reorder([1], 42)).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST
    });

    expect(memberRepository.update).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
  });
});
