import { HttpStatus } from '@nestjs/common';
import { ProjectAccessService } from '../project-access.service';

describe('ProjectAccessService', () => {
  const projectRepository = { findByPk: jest.fn() };
  const memberRepository = { findOne: jest.fn() };
  const service = new ProjectAccessService(
    projectRepository as any,
    memberRepository as any
  );

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
});
