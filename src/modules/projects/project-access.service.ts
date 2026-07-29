import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import { Project } from './model/project.model';
import { ProjectMember } from './model/project-member.model';

@Injectable()
export class ProjectAccessService {
  constructor(
    @InjectModel(Project) private projectRepository: typeof Project,
    @InjectModel(ProjectMember) private memberRepository: typeof ProjectMember
  ) {}

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

    const members = await this.memberRepository.findAll({
      attributes: ['userId'],
      where: {
        projectId,
        userId: { [Op.in]: normalizedUserIds }
      },
      transaction
    });
    const memberIds = new Set(members.map(member => Number(member.userId)));
    const hasExternalAssignee = normalizedUserIds.some(
      userId => !memberIds.has(userId)
    );

    if (hasExternalAssignee) {
      throw new HttpException(
        'Исполнителями могут быть только участники проекта',
        HttpStatus.BAD_REQUEST
      );
    }
  }
}
