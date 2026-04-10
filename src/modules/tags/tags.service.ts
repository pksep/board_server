import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { ProjectTag } from './model/project-tag.model';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { TaskTag } from '../tasks/model/task-tag.model';

@Injectable()
export class TagsService {
  private readonly logger = new Logger(TagsService.name);

  constructor(
    @InjectModel(ProjectTag) private tagRepository: typeof ProjectTag,
    @InjectModel(TaskTag) private taskTagRepository: typeof TaskTag,
    private sequelize: Sequelize
  ) {}

  /**
   * Получить все теги проекта
   */
  async getByProject(projectId: number): Promise<ProjectTag[]> {
    try {
      return await this.tagRepository.findAll({
        where: { projectId },
        order: [['label', 'ASC']]
      });
    } catch (error) {
      this.logger.error('getByProject failed', error);
      throw new HttpException(
        'Ошибка при получении тегов',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Создать тег
   */
  async create(projectId: number, dto: CreateTagDto): Promise<ProjectTag> {
    try {
      const tag = await this.tagRepository.create({
        projectId,
        label: dto.label,
        color: dto.color,
        description: dto.description || ''
      } as any);

      return tag;
    } catch (error) {
      this.logger.error('create tag failed', error);
      throw new HttpException(
        'Ошибка при создании тега',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Обновить тег
   */
  async update(id: number, dto: UpdateTagDto): Promise<ProjectTag> {
    try {
      const tag = await this.tagRepository.findByPk(id);
      if (!tag) {
        throw new HttpException('Тег не найден', HttpStatus.NOT_FOUND);
      }

      if (dto.label !== undefined) tag.label = dto.label;
      if (dto.color !== undefined) tag.color = dto.color;
      if (dto.description !== undefined) tag.description = dto.description;

      await tag.save();
      return tag;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('update tag failed', error);
      throw new HttpException(
        'Ошибка при обновлении тега',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Soft delete тега + каскадное удаление TaskTag связей (в транзакции)
   */
  async delete(id: number): Promise<void> {
    const transaction = await this.sequelize.transaction();
    try {
      const tag = await this.tagRepository.findByPk(id, { transaction });
      if (!tag) {
        throw new HttpException('Тег не найден', HttpStatus.NOT_FOUND);
      }

      // Удаляем связи задач с этим тегом
      await this.taskTagRepository.destroy({
        where: { projectTagId: id },
        transaction
      });

      await tag.destroy({ transaction }); // paranoid → soft delete
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      if (error instanceof HttpException) throw error;
      this.logger.error('delete tag failed', error);
      throw new HttpException(
        'Ошибка при удалении тега',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
