import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { EnumUserRole } from './enums/role.enum';
import { BanUserDto } from './dto/ban-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './model/users.model';
import { GetUsersDto } from './dto/get-users.dto';
import { FindOptions, Transaction } from 'sequelize';
import { Op } from 'sequelize';

import { Sequelize } from 'sequelize-typescript';
import { CreateUserDto } from './dto/create-user.dto';
import { sha256 } from 'js-sha256';
import { Cache } from 'cache-manager';
import { IByQuery } from 'src/utils/interfaces';
import { CachePrefixEnum } from 'src/utils/hash';
import { LoggerService } from '../logger/logger.service';

import { CheckTabelUniqueDto } from './dto/tabel-unique.dto';
import { IPaginationReturnData } from 'src/core/interface/pagination';

@Injectable()
export class UsersService {
  constructor(
    private logger: LoggerService,
    @InjectModel(User) private userRepository: typeof User,

    private sequelize: Sequelize,
    @Inject('CACHE_MANAGER') private cacheManager: Cache
  ) {}

  /**
   * Функция для создания пользователя
   */
  async createUser(dto: CreateUserDto, userId: number): Promise<User> {
    const transaction = await this.sequelize.transaction();
    try {
      void userId;

      if (!dto.serviceNumber) {
        throw new HttpException(
          'Табельный номер должен обязательно присутствовать!',
          HttpStatus.BAD_REQUEST
        );
      }

      const tabel = await this.userRepository.findOne({
        where: { serviceNumber: dto.serviceNumber },
        transaction
      });

      if (tabel) {
        throw new HttpException(
          'Табельный номер не может повторяться',
          HttpStatus.BAD_REQUEST
        );
      }

      const createdUser = await this.userRepository.create(
        {
          initial: dto.initial,
          login: dto.login,
          serviceNumber: dto.serviceNumber,
          role: dto.role || '-',
          image: dto.image ?? null,
          ban: false
        },
        { transaction }
      );

      const user = await this.userRepository.findByPk(createdUser.id, {
        include: [],
        transaction
      });

      if (!user)
        throw new HttpException(
          'Произошла ошибка при получении обновлении пользователя',
          HttpStatus.NOT_FOUND
        );

      await this.upCreateUser(user, dto, true, transaction);

      await transaction.commit();

      return user;
    } catch (error) {
      await transaction.rollback();
      throw new HttpException(
        error instanceof Error ? error.message : 'Внутренняя ошибка сервера',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Функция для обновления существующего пользователя
   */
  async updateUser(dto: UpdateUserDto, userId: number): Promise<User> {
    const transaction = await this.sequelize.transaction();
    try {
      void userId;

      if (!dto.serviceNumber) {
        throw new HttpException(
          'Табельный номер должен обязательно присутствовать!',
          HttpStatus.BAD_REQUEST
        );
      }

      const tabel = await this.userRepository.findOne({
        where: { serviceNumber: dto.serviceNumber, id: { [Op.ne]: dto.id } },
        transaction
      });

      if (tabel) {
        throw new HttpException(
          'Табельный номер не может повторяться',
          HttpStatus.BAD_REQUEST
        );
      }

      const user = await this.userRepository.findByPk(dto.id, {
        transaction
      });

      if (!user)
        throw new HttpException(
          'Произошла ошибка при получении обновлении пользователя',
          HttpStatus.NOT_FOUND
        );

      await this.upCreateUser(user, dto, false, transaction);
      await transaction.commit();

      return user;
    } catch (error) {
      await transaction.rollback();
      throw new HttpException(
        error instanceof Error ? error.message : 'Внутренняя ошибка сервера',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Запрос почти полностью реализет запрос через репозиторий
   * Получаем массив Сборок по запросу
   * @param params
   * @returns
   */
  async getByQuery(params: IByQuery): Promise<User[]> {
    try {
      return await this.userRepository.findAll(params);
    } catch (error) {
      this.logger.error(error, UsersService.name);
    }
  }

  /**
   * Функция для обновления данных юезра
   * @param dto
   * @param files
   * @param userId
   * @returns
   */
  async upCreateUser(
    user: User,
    dto: UpdateUserDto | CreateUserDto,
    isCreate: boolean,
    transaction: Transaction
  ): Promise<User> {
    try {
      // Менять роль Администратора может только Администратор
      // Давать и удалять возможность удаленной работы может только Администратор

      const oldTabel = user.serviceNumber;

      user.initial = dto.initial;
      user.serviceNumber = dto.serviceNumber;
      user.login = dto.login;

      if ('role' in dto) user.role = (dto.role as EnumUserRole) || '-';
      if ('image' in dto) user.image = dto.image ?? null;

      if (oldTabel !== dto.serviceNumber) {
        await this.cacheManager.del(
          sha256(`${CachePrefixEnum.UserTabel}_${oldTabel}`)
        );

        await this.cacheManager.set(
          sha256(`${CachePrefixEnum.UserTabel}_${dto.serviceNumber}`),
          user?.id || 0
        );
      }

      await user.save({ transaction });

      return user;
    } catch (error) {
      await transaction.rollback();
      throw new HttpException(
        error instanceof Error ? error.message : 'Внутренняя ошибка сервера',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async checkTabelUnique(dto: CheckTabelUniqueDto): Promise<number | null> {
    try {
      const cashedId: number = await this.cacheManager.get(
        sha256(`${CachePrefixEnum.UserTabel}_${dto.serviceNumber}`)
      );

      if (cashedId) return cashedId;

      const queryCondition = {
        where: { serviceNumber: { [Op.iLike]: dto.serviceNumber } },
        attributes: ['id'],
        raw: true
      };

      const entity = await this.userRepository.findOne(queryCondition);

      await this.cacheManager.set(
        sha256(`${CachePrefixEnum.UserTabel}_${dto.serviceNumber}`),
        entity?.id || 0
      );

      return entity?.id || 0;
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : 'Внутренняя ошибка сервера',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async getUsersByIds(ids: number[], attributes = ['id']): Promise<User[]> {
    const users = await this.userRepository.findAll({
      where: {
        id: {
          [Op.in]: ids
        }
      },
      attributes
    });

    return users;
  }

  async getUsersPagination(
    dto: GetUsersDto
  ): Promise<IPaginationReturnData<User>> {
    try {
      const offset = (dto.page - 1) * 20;

      const where: any = {
        ban: dto.ban,
        [Op.or]: {
          serviceNumber: { [Op.iLike]: `%${dto.searchSring}%` },
          initial: { [Op.iLike]: `%${dto.searchSring}%` },
          login: { [Op.iLike]: `%${dto.searchSring}%` }
        }
      };

      const queryConditions: FindOptions<User> = {
        where,
        order: [['serviceNumber', 'ASC']],
        offset,
        limit: 20
      };

      if (dto?.ids?.length) {
        queryConditions.where['id'] = { [Op.in]: dto.ids };
      }

      if (dto.light) {
        queryConditions.attributes = [
          'id',
          'initial',
          'login',
          'serviceNumber',
          'ban'
        ];
      }

      const users = await this.userRepository.findAndCountAll(queryConditions);

      return users;
    } catch (error) {
      throw new HttpException(
        'Не удалось получить пользователей',
        HttpStatus.BAD_GATEWAY
      );
    }
  }

  /**
   * Получаем пользователя по id
   * @param id
   * @param includes
   * @returns
   */
  async getUserByPk(id: number): Promise<User> {
    try {
      const user = await this.userRepository.findByPk(id);
      return user;
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : 'Внутренняя ошибка сервера',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   *
   * @param _id
   * @param attr
   * @returns
   */
  async getUserAttrByPk(_id: number, attr = ['id']): Promise<User> {
    try {
      const user = await this.userRepository.findByPk(_id, {
        attributes: attr
      });

      return user;
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : 'Внутренняя ошибка сервера',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async getUserByAttrubute(
    attributeKey: string,
    attributeValue: string
  ): Promise<User> {
    try {
      const user = await this.userRepository.findOne({
        where: { [`${attributeKey}`]: attributeValue },
        include: []
      });
      return user;
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : 'Внутренняя ошибка сервера',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async userToArchive(dto: BanUserDto, userId: number): Promise<User> {
    const transaction = await this.sequelize.transaction();
    try {
      void userId;

      const user = await this.userRepository.findByPk(dto.userId, {
        transaction
      });

      if (!user)
        throw new HttpException('Пользователь не найден', HttpStatus.NOT_FOUND);

      if (!user.ban && user.role === EnumUserRole.admin) {
        const activeAdminsCount = await this.userRepository.count({
          where: {
            role: EnumUserRole.admin,
            ban: false
          },
          transaction
        });

        if (activeAdminsCount <= 1) {
          throw new HttpException(
            'Нельзя заблокировать последнего администратора',
            HttpStatus.BAD_REQUEST
          );
        }
      }

      user.ban = !user.ban;

      await user.save({ transaction });

      await transaction.commit();

      return user;
    } catch (error) {
      await transaction.rollback();
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Не удалось заблокировать пользователя',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async getUsersList(): Promise<User[]> {
    try {
      const userList = await this.userRepository.findAll({
        attributes: ['id', 'login', 'serviceNumber', 'initial', 'image'],
        where: {
          ban: false
        },
        order: [['login', 'ASC']]
      });

      return userList;
    } catch (error) {
      this.logger.error(error, UsersService.name);
      throw new HttpException(
        'Не удалось получить пользователей',
        HttpStatus.NOT_FOUND
      );
    }
  }
}
