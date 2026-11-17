import { HttpStatus } from '@nestjs/common';
import { ProjectsService } from './projects.service';

describe('ProjectsService project order', () => {
  const transaction = {
    LOCK: { UPDATE: 'UPDATE' },
    commit: jest.fn(),
    rollback: jest.fn()
  };
  const projectRepository = {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn()
  };
  const memberRepository = {
    findAll: jest.fn(),
    update: jest.fn(),
    bulkCreate: jest.fn(),
    destroy: jest.fn()
  };
  const favoriteRepository = {};
  const sequelize = {
    transaction: jest.fn().mockResolvedValue(transaction),
    query: jest.fn()
  };
  const projectAccess = {
    assertCanRead: jest.fn(),
    assertCanManage: jest.fn()
  };
  const service = new ProjectsService(
    projectRepository as any,
    memberRepository as any,
    favoriteRepository as any,
    sequelize as any,
    projectAccess as any
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

    expect(memberRepository.update).not.toHaveBeenCalled();
    expect(sequelize.query).toHaveBeenCalledTimes(1);
    expect(sequelize.query).toHaveBeenCalledWith(
      expect.stringContaining('member.user_id = $userId'),
      {
        bind: { ids: [2, 1], userId: 42, updatedAt: expect.any(Date) },
        transaction
      }
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

  it('сохраняет настройку производства при создании проекта', async () => {
    const createdProject = { id: 7, showInProduction: true };
    projectRepository.findOne.mockResolvedValue(null);
    projectRepository.create.mockResolvedValue(createdProject);
    projectRepository.findByPk.mockResolvedValue(createdProject);
    projectAccess.assertCanRead.mockResolvedValue(createdProject);
    memberRepository.findAll.mockResolvedValue([]);
    memberRepository.bulkCreate.mockResolvedValue([]);

    await expect(
      service.create(
        {
          title: 'Производственный проект',
          prefix: 'PRD',
          showInProduction: true
        },
        42
      )
    ).resolves.toBe(createdProject);

    expect(projectRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ showInProduction: true }),
      { transaction }
    );
  });

  it('обновляет и возвращает сохранённую настройку производства', async () => {
    const project = {
      id: 7,
      createdById: 42,
      showInProduction: true,
      save: jest.fn()
    };
    projectAccess.assertCanManage.mockResolvedValue(project);
    projectAccess.assertCanRead.mockResolvedValue(project);
    projectRepository.findByPk.mockResolvedValue(project);

    await expect(
      service.update({ id: project.id, showInProduction: false }, 42)
    ).resolves.toBe(project);

    expect(project.showInProduction).toBe(false);
    expect(project.save).toHaveBeenCalledWith({ transaction });
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });
});
