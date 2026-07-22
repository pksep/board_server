import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
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
}
