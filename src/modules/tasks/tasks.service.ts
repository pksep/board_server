import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Task } from './model/task.model';
import { TaskAssignee } from './model/task-assignee.model';
import { TaskTag } from './model/task-tag.model';
import { TaskAttachment } from './model/task-attachment.model';
import { CreateTaskDto } from './dto/create-task.dto';
import { CreateAttachmentDto } from './dto/create-attachment.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { Project } from '../projects/model/project.model';
import { BoardColumn } from '../columns/model/board-column.model';
import { Board } from '../boards/model/board.model';
import { User } from '../users/model/users.model';
import { ProjectTag } from '../tags/model/project-tag.model';
import { WsGateway } from '../ws/ws.gateway';
import { S3Service } from '../s3/s3.service';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectModel(Task) private taskRepository: typeof Task,
    @InjectModel(TaskAssignee) private assigneeRepository: typeof TaskAssignee,
    @InjectModel(TaskTag) private taskTagRepository: typeof TaskTag,
    @InjectModel(TaskAttachment)
    private attachmentRepository: typeof TaskAttachment,
    @InjectModel(Project) private projectRepository: typeof Project,
    @InjectModel(BoardColumn) private columnRepository: typeof BoardColumn,
    private sequelize: Sequelize,
    private wsGateway: WsGateway,
    private s3Service: S3Service
  ) {}

  /** Получить boardId по columnId */
  private async getBoardIdByColumnId(columnId: number): Promise<number> {
    const col = await this.columnRepository.findByPk(columnId, {
      attributes: ['boardId']
    });
    return col?.boardId;
  }

  /** Получить projectId через column → board → project */
  private async getProjectIdByColumnId(
    columnId: number,
    transaction?: any
  ): Promise<number> {
    const column = await this.columnRepository.findByPk(columnId, {
      include: [{ model: Board, attributes: ['projectId'] }],
      ...(transaction ? { transaction } : {})
    });
    if (!column) {
      throw new HttpException('Колонка не найдена', HttpStatus.NOT_FOUND);
    }
    return column.board.projectId;
  }

  /** Общие include для задачи */
  private taskIncludes() {
    return [
      {
        model: TaskAssignee,
        include: [
          { model: User, attributes: ['id', 'login', 'initial', 'image'] }
        ]
      },
      {
        model: TaskTag,
        include: [
          {
            model: ProjectTag,
            attributes: ['id', 'label', 'color', 'description']
          }
        ]
      },
      {
        model: TaskAttachment,
        attributes: ['id', 'fileName', 'objectName', 'mimeType', 'size']
      },
      {
        model: Task,
        as: 'subtasks',
        attributes: [
          'id',
          'taskNumber',
          'title',
          'priority',
          'dueDate',
          'parentTaskId'
        ],
        include: [
          {
            model: TaskAssignee,
            include: [{ model: User, attributes: ['id', 'login', 'initial'] }]
          },
          {
            model: TaskTag,
            include: [
              { model: ProjectTag, attributes: ['id', 'label', 'color'] }
            ]
          }
        ]
      }
    ];
  }

  /**
   * Получить все задачи доски
   */
  async getByBoard(boardId: number): Promise<Task[]> {
    try {
      const columns = await this.columnRepository.findAll({
        where: { boardId },
        attributes: ['id']
      });
      const columnIds = columns.map(c => c.id);

      return await this.taskRepository.findAll({
        where: { columnId: columnIds, parentTaskId: null },
        include: this.taskIncludes(),
        order: [['order', 'ASC']]
      });
    } catch (error) {
      this.logger.error('getByBoard failed', error);
      throw new HttpException(
        'Ошибка при получении задач',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Получить все задачи колонки
   */
  async getByColumn(columnId: number): Promise<Task[]> {
    try {
      return await this.taskRepository.findAll({
        where: { columnId, parentTaskId: null },
        include: this.taskIncludes(),
        order: [['order', 'ASC']]
      });
    } catch (error) {
      this.logger.error('getByColumn failed', error);
      throw new HttpException(
        'Ошибка при получении задач колонки',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Получить задачу по ID
   */
  async getById(id: number): Promise<Task> {
    try {
      const task = await this.taskRepository.findByPk(id, {
        include: this.taskIncludes()
      });
      if (!task) {
        throw new HttpException('Задача не найдена', HttpStatus.NOT_FOUND);
      }
      return task;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('getById failed', error);
      throw new HttpException(
        'Ошибка при получении задачи',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Создать задачу в колонке
   */
  async create(
    columnId: number,
    dto: CreateTaskDto,
    userId: number
  ): Promise<Task> {
    const transaction = await this.sequelize.transaction();
    try {
      const projectId = await this.getProjectIdByColumnId(
        columnId,
        transaction
      );

      // Инкрементируем счётчик задач в проекте
      await this.projectRepository.increment('taskCounter', {
        where: { id: projectId },
        transaction
      });

      // Перечитываем проект чтобы получить актуальный taskCounter
      const project = await this.projectRepository.findByPk(projectId, {
        attributes: ['id', 'taskCounter'],
        transaction
      });
      if (!project) {
        throw new HttpException('Проект не найден', HttpStatus.NOT_FOUND);
      }
      const taskCounter = project.taskCounter;

      // Вставляем новую верхнеуровневую задачу в начало колонки.
      await this.taskRepository.update(
        { order: this.sequelize.literal('"order" + 1') as any },
        {
          where: {
            columnId,
            parentTaskId: null
          },
          transaction
        }
      );

      const task = await this.taskRepository.create(
        {
          taskNumber: taskCounter,
          title: dto.title,
          description: dto.description || '',
          priority: dto.priority || '',
          approvalStatus: dto.approvalStatus || '',
          dueDate: dto.dueDate || null,
          columnId,
          order: 0,
          createdById: userId
        } as any,
        { transaction }
      );

      // Добавляем исполнителей
      if (dto.assigneeIds?.length) {
        await this.assigneeRepository.bulkCreate(
          dto.assigneeIds.map(uid => ({
            taskId: task.id,
            userId: uid
          })) as any[],
          { transaction }
        );
      }

      // Добавляем теги
      if (dto.tagIds?.length) {
        await this.taskTagRepository.bulkCreate(
          dto.tagIds.map(tagId => ({
            taskId: task.id,
            projectTagId: tagId
          })) as any[],
          { transaction }
        );
      }

      await transaction.commit();
      const result = await this.getById(task.id);

      // WS: уведомляем о создании
      const boardId = await this.getBoardIdByColumnId(columnId);
      this.wsGateway.emitTaskCreated(boardId, result);

      return result;
    } catch (error) {
      await transaction.rollback();
      if (error instanceof HttpException) throw error;
      this.logger.error('create task failed', error);
      throw new HttpException(
        'Ошибка при создании задачи',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Создать подзадачу
   */
  async createSubtask(
    parentId: number,
    dto: CreateTaskDto,
    userId: number
  ): Promise<Task> {
    const transaction = await this.sequelize.transaction();
    try {
      const parent = await this.taskRepository.findByPk(parentId, {
        transaction
      });
      if (!parent) {
        throw new HttpException(
          'Родительская задача не найдена',
          HttpStatus.NOT_FOUND
        );
      }

      const projectId = await this.getProjectIdByColumnId(
        parent.columnId,
        transaction
      );

      await this.projectRepository.increment('taskCounter', {
        where: { id: projectId },
        transaction
      });

      const updatedProject = await this.projectRepository.findByPk(projectId, {
        attributes: ['id', 'taskCounter'],
        transaction
      });
      const taskCounter = updatedProject?.taskCounter;
      if (!taskCounter) {
        throw new HttpException(
          'Проект не найден или не удалось получить счётчик',
          HttpStatus.NOT_FOUND
        );
      }

      const task = await this.taskRepository.create(
        {
          taskNumber: taskCounter,
          title: dto.title,
          description: dto.description || '',
          priority: dto.priority || '',
          dueDate: dto.dueDate || null,
          columnId: parent.columnId,
          parentTaskId: parentId,
          order: 0,
          createdById: userId
        } as any,
        { transaction }
      );

      if (dto.assigneeIds?.length) {
        await this.assigneeRepository.bulkCreate(
          dto.assigneeIds.map(uid => ({
            taskId: task.id,
            userId: uid
          })) as any[],
          { transaction }
        );
      }

      if (dto.tagIds?.length) {
        await this.taskTagRepository.bulkCreate(
          dto.tagIds.map(tagId => ({
            taskId: task.id,
            projectTagId: tagId
          })) as any[],
          { transaction }
        );
      }

      await transaction.commit();
      const result = await this.getById(task.id);

      // WS: уведомляем о создании подзадачи
      const boardId = await this.getBoardIdByColumnId(parent.columnId);
      this.wsGateway.emitTaskCreated(boardId, result);

      return result;
    } catch (error) {
      await transaction.rollback();
      if (error instanceof HttpException) throw error;
      this.logger.error('createSubtask failed', error);
      throw new HttpException(
        `Ошибка при создании подзадачи: ${error instanceof Error ? error.message : String(error)}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Получить подзадачи
   */
  async getSubtasks(parentId: number): Promise<Task[]> {
    try {
      return await this.taskRepository.findAll({
        where: { parentTaskId: parentId },
        include: this.taskIncludes(),
        order: [['createdAt', 'ASC']]
      });
    } catch (error) {
      this.logger.error('getSubtasks failed', error);
      throw new HttpException(
        'Ошибка при получении подзадач',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Обновить задачу
   */
  async update(id: number, dto: UpdateTaskDto): Promise<Task> {
    const transaction = await this.sequelize.transaction();
    try {
      const task = await this.taskRepository.findByPk(id, { transaction });
      if (!task) {
        throw new HttpException('Задача не найдена', HttpStatus.NOT_FOUND);
      }

      if (dto.title !== undefined) task.title = dto.title;
      if (dto.description !== undefined) task.description = dto.description;
      if (dto.priority !== undefined) task.priority = dto.priority;
      if (dto.dueDate !== undefined) task.dueDate = dto.dueDate as any;
      if (dto.approvalStatus !== undefined)
        task.approvalStatus = dto.approvalStatus;

      await task.save({ transaction });

      // Обновляем исполнителей
      if (dto.assigneeIds !== undefined) {
        await this.assigneeRepository.destroy({
          where: { taskId: id },
          transaction
        });
        if (dto.assigneeIds.length) {
          await this.assigneeRepository.bulkCreate(
            dto.assigneeIds.map(uid => ({ taskId: id, userId: uid })) as any[],
            { transaction }
          );
        }
      }

      // Обновляем теги
      if (dto.tagIds !== undefined) {
        await this.taskTagRepository.destroy({
          where: { taskId: id },
          transaction
        });
        if (dto.tagIds.length) {
          await this.taskTagRepository.bulkCreate(
            dto.tagIds.map(tagId => ({
              taskId: id,
              projectTagId: tagId
            })) as any[],
            { transaction }
          );
        }
      }

      await transaction.commit();
      const result = await this.getById(id);

      // WS: уведомляем об обновлении
      const boardId = await this.getBoardIdByColumnId(result.columnId);
      this.wsGateway.emitTaskUpdated(boardId, result);

      return result;
    } catch (error) {
      await transaction.rollback();
      if (error instanceof HttpException) throw error;
      this.logger.error('update task failed', error);
      throw new HttpException(
        'Ошибка при обновлении задачи',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Переместить задачу (с пересчётом order в целевой колонке)
   */
  async move(id: number, dto: MoveTaskDto): Promise<Task> {
    const transaction = await this.sequelize.transaction();
    try {
      const task = await this.taskRepository.findByPk(id, { transaction });
      if (!task) {
        throw new HttpException('Задача не найдена', HttpStatus.NOT_FOUND);
      }

      const fromColumnId = task.columnId;

      // Сдвигаем order в целевой колонке: все задачи с order >= dto.order сдвигаем на +1
      await this.taskRepository.update(
        { order: this.sequelize.literal('"order" + 1') as any },
        {
          where: {
            columnId: dto.columnId,
            parentTaskId: null,
            order: { [Op.gte]: dto.order },
            id: { [Op.ne]: id }
          },
          transaction
        }
      );

      task.columnId = dto.columnId;
      task.order = dto.order;
      await task.save({ transaction });

      await transaction.commit();

      // WS: уведомляем о перемещении
      const boardId = await this.getBoardIdByColumnId(dto.columnId);
      this.wsGateway.emitTaskMoved(boardId, {
        taskId: id,
        fromColumnId,
        toColumnId: dto.columnId,
        order: dto.order
      });

      return task;
    } catch (error) {
      await transaction.rollback();
      if (error instanceof HttpException) throw error;
      this.logger.error('move task failed', error);
      throw new HttpException(
        'Ошибка при перемещении задачи',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Soft delete задачи
   */
  async delete(id: number): Promise<void> {
    try {
      const task = await this.taskRepository.findByPk(id);
      if (!task) {
        throw new HttpException('Задача не найдена', HttpStatus.NOT_FOUND);
      }

      const boardId = await this.getBoardIdByColumnId(task.columnId);
      await task.destroy();

      // WS: уведомляем об удалении
      this.wsGateway.emitTaskDeleted(boardId, id);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('delete task failed', error);
      throw new HttpException(
        'Ошибка при удалении задачи',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Получить Presigned URL для прямой загрузки в MinIO
   */
  async generatePresignedUrl(
    taskId: number,
    dto: CreateAttachmentDto
  ): Promise<{ presignedUrl: string; objectName: string }> {
    try {
      const task = await this.taskRepository.findByPk(taskId);
      if (!task) {
        throw new HttpException('Задача не найдена', HttpStatus.NOT_FOUND);
      }

      const ext = dto.fileName.split('.').pop() || 'bin';
      const objectName = `tasks/${taskId}/${uuidv4()}.${ext}`;

      const presignedUrl = await this.s3Service.getPresignedPutUrl(objectName);

      return { presignedUrl, objectName };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('generatePresignedUrl failed', error);
      throw new HttpException(
        'Ошибка при генерации URL для загрузки',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Подтвердить успешную загрузку и привязать к задаче
   */
  async confirmAttachment(
    taskId: number,
    dto: CreateAttachmentDto,
    userId: number
  ): Promise<TaskAttachment> {
    try {
      const task = await this.taskRepository.findByPk(taskId);
      if (!task) {
        throw new HttpException('Задача не найдена', HttpStatus.NOT_FOUND);
      }
      if (!dto.objectName) {
        throw new HttpException(
          'Не передан objectName',
          HttpStatus.BAD_REQUEST
        );
      }

      // Проверяем, что файл реально загружен в MinIO
      const exists = await this.s3Service.exists(dto.objectName);
      if (!exists) {
        throw new HttpException(
          'Файл не найден в хранилище. Загрузите файл перед подтверждением.',
          HttpStatus.BAD_REQUEST
        );
      }

      const attachment = await this.attachmentRepository.create({
        taskId,
        fileName: dto.fileName,
        objectName: dto.objectName,
        mimeType: dto.mimeType,
        size: dto.size,
        uploadedById: userId
      } as any);

      const boardId = await this.getBoardIdByColumnId(task.columnId);
      const updatedTask = await this.getById(taskId);
      this.wsGateway.emitTaskUpdated(boardId, updatedTask);

      return attachment;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('confirmAttachment failed', error);
      throw new HttpException(
        'Ошибка при подтверждении вложения',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Удалить вложение
   */
  async deleteAttachment(taskId: number, attachmentId: number): Promise<void> {
    try {
      const attachment = await this.attachmentRepository.findOne({
        where: { id: attachmentId, taskId }
      });
      if (!attachment) {
        throw new HttpException('Вложение не найдено', HttpStatus.NOT_FOUND);
      }

      await this.s3Service.removeObject(attachment.objectName);
      await attachment.destroy();

      const task = await this.taskRepository.findByPk(taskId);
      if (task) {
        const boardId = await this.getBoardIdByColumnId(task.columnId);
        const updatedTask = await this.getById(taskId);
        this.wsGateway.emitTaskUpdated(boardId, updatedTask);
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('deleteAttachment failed', error);
      throw new HttpException(
        'Ошибка при удалении вложения',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
