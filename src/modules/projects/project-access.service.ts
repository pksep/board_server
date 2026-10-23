import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import { Project } from './model/project.model';
import { ProjectMember } from './model/project-member.model';
import { User } from '../users/model/users.model';

@Injectable()
export class ProjectAccessService {
  constructor(
    @InjectModel(Project) private projectRepository: typeof Project,
    @InjectModel(ProjectMember) private memberRepository: typeof ProjectMember
  ) {}

  /** Возвращает проекты по тем же правилам владельца и участника, что assertCanRead. */
  async getReadableProjectIds(userId: number): Promise<number[]> {
    const memberships = await this.memberRepository.findAll({
      attributes: ['projectId'],
      where: { userId }
    });
    const projects = await this.projectRepository.findAll({
      attributes: ['id'],
      where: {
        [Op.or]: [
          { createdById: userId },
          { id: { [Op.in]: memberships.map(member => member.projectId) } }
        ]
      }
    });

    return projects.map(project => project.id);
  }

  async assertCanRead(
    projectId: number,
    userId: number,
    transaction?: Transaction
  ): Promise<Project> {
    const project = await this.projectRepository.findByPk(projectId, {
      transaction
    });

    if (!project) {
      throw new HttpException('Проект не найден', HttpStatus.NOT_FOUND);
    }

    if (project.createdById === userId) return project;

    const member = await this.memberRepository.findOne({
      where: { projectId, userId },
      transaction
    });

    if (!member) {
      throw new HttpException('Проект не найден', HttpStatus.NOT_FOUND);
    }

    return project;
  }

  async assertCanManage(
    projectId: number,
    userId: number,
    transaction?: Transaction
  ): Promise<Project> {
    const project = await this.projectRepository.findByPk(projectId, {
      transaction
    });

    if (!project) {
      throw new HttpException('Проект не найден', HttpStatus.NOT_FOUND);
    }

    if (project.createdById !== userId) {
      const member = await this.memberRepository.findOne({
        where: { projectId, userId },
        transaction
      });
      if (!member) {
        throw new HttpException('Проект не найден', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Недостаточно прав для изменения проекта',
        HttpStatus.FORBIDDEN
      );
    }

    return project;
  }

  async assertAssigneesBelongToProject(
    projectId: number,
    userIds: number[] = [],
    transaction?: Transaction
  ): Promise<void> {
    const normalizedUserIds = [
      ...new Set(userIds.map(Number).filter(Number.isInteger))
    ];
    if (!normalizedUserIds.length) return;

    const memberIds = new Set(
      await this.getActiveMemberIds(projectId, transaction, normalizedUserIds)
    );
    const hasExternalAssignee = normalizedUserIds.some(
      userId => !memberIds.has(userId)
    );

    if (hasExternalAssignee) {
      throw new HttpException(
        'Исполнителями могут быть только активные участники проекта',
        HttpStatus.BAD_REQUEST
      );
    }
  }

  /** Единый источник действующих участников для назначений и состава доски. */
  async getActiveMemberIds(
    projectId: number,
    transaction?: Transaction,
    userIds?: number[]
  ): Promise<number[]> {
    const members = await this.memberRepository.findAll({
      attributes: ['userId'],
      include: [
        { model: User, attributes: [], where: { ban: false }, required: true }
      ],
      // Блокировка не позволяет архивированию пересечься с новым назначением.
      lock: transaction ? Transaction.LOCK.SHARE : undefined,
      where: {
        projectId,
        ...(userIds ? { userId: { [Op.in]: userIds } } : {})
      },
      transaction
    });

    return members.map(member => Number(member.userId));
  }
}
