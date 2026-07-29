import { HttpStatus } from '@nestjs/common';
import { ProjectAccessService } from '../project-access.service';

describe('ProjectAccessService', () => {
  const projectRepository = { findByPk: jest.fn() };
  const memberRepository = {
    findOne: jest.fn(),
    findAll: jest.fn()
  };
  const service = new ProjectAccessService(
    projectRepository as any,
    memberRepository as any
  );
  const transaction = {} as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('разрешает владельцу читать проект без дополнительного поиска участника', async () => {
    const project = { id: 1, createdById: 10 };
    projectRepository.findByPk.mockResolvedValue(project);

    await expect(service.assertCanRead(1, 10)).resolves.toBe(project);
    expect(memberRepository.findOne).not.toHaveBeenCalled();
  });

  it('разрешает участнику читать проект', async () => {
    const project = { id: 1, createdById: 10 };
    projectRepository.findByPk.mockResolvedValue(project);
    memberRepository.findOne.mockResolvedValue({ projectId: 1, userId: 20 });

    await expect(service.assertCanRead(1, 20)).resolves.toBe(project);
  });

  it('скрывает чужой проект от постороннего пользователя', async () => {
    projectRepository.findByPk.mockResolvedValue({ id: 1, createdById: 10 });
    memberRepository.findOne.mockResolvedValue(null);

    await expect(service.assertCanRead(1, 30)).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND
    });
  });

  it('разрешает изменять проект только владельцу', async () => {
    const project = { id: 1, createdById: 10 };
    projectRepository.findByPk.mockResolvedValue(project);
    memberRepository.findOne.mockResolvedValue({ projectId: 1, userId: 20 });

    await expect(service.assertCanManage(1, 10)).resolves.toBe(project);
    await expect(service.assertCanManage(1, 20)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN
    });
  });

  it('не раскрывает постороннему существование проекта при изменении', async () => {
    projectRepository.findByPk.mockResolvedValue({ id: 1, createdById: 10 });
    memberRepository.findOne.mockResolvedValue(null);

    await expect(service.assertCanManage(1, 30)).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND
    });
  });

  it('разрешает назначать только участников проекта', async () => {
    memberRepository.findAll.mockResolvedValue([{ userId: 2 }, { userId: 3 }]);

    await expect(
      service.assertAssigneesBelongToProject(10, [3, 2, 3], transaction)
    ).resolves.toBeUndefined();
    expect(memberRepository.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: ['userId'],
        where: expect.objectContaining({ projectId: 10 }),
        transaction
      })
    );
  });

  it('отклоняет пользователя вне проекта', async () => {
    memberRepository.findAll.mockResolvedValue([{ userId: 2 }]);

    await expect(
      service.assertAssigneesBelongToProject(10, [2, 99], transaction)
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      message: 'Исполнителями могут быть только участники проекта'
    });
  });
});
