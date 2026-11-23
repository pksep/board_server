import { Attributes, Model, Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import models from '../../../configs/models';
import { User } from '../../users/model/users.model';
import { ProjectTag } from '../../tags/model/project-tag.model';
import { Project } from '../model/project.model';
import { ProjectMember } from '../model/project-member.model';
import { UserFavorite } from '../model/user-favorite.model';
import { ProjectsService } from '../projects.service';
import { ProjectAccessService } from '../project-access.service';

const databaseUrl = process.env.BOARD_ARCHIVE_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

/** Сохраняет модель только в выделенной тестовой базе. */
async function persist<T extends Model>(
  record: T,
  values: Partial<Attributes<T>>
): Promise<T> {
  record.set(values);

  return record.save();
}

describeWithDatabase('Project member position aggregation', () => {
  let database: Sequelize;
  let service: ProjectsService;
  let users: User[];

  beforeAll(async (): Promise<void> => {
    if (
      !/^\/board_archive_test_[a-z0-9_]+$/.test(new URL(databaseUrl!).pathname)
    )
      throw new Error('Dedicated test database required');

    // Сохраняем идентичность lazy-association моделей при Jest resetModules.
    jest.doMock('../model/project-member.model', () => ({ ProjectMember }));
    jest.doMock('../model/user-favorite.model', () => ({ UserFavorite }));
    jest.doMock('../../tags/model/project-tag.model', () => ({ ProjectTag }));

    database = new Sequelize(databaseUrl!, {
      dialect: 'postgres',
      models,
      logging: false,
      pool: { max: 2, min: 0 }
    });
    await database.sync();
    users = await Promise.all(
      ['owner', 'member', 'negative', 'new'].map(label =>
        persist(User.build(), {
          initial: label,
          login: label,
          serviceNumber: `order-${label}`
        })
      )
    );
    const projects = await Promise.all(
      ['ORDERA', 'ORDERB', 'ORDERC'].map(prefix =>
        persist(Project.build(), {
          title: prefix,
          prefix,
          createdById: users[0].id
        })
      )
    );
    for (const [projectIndex, userIndex, order] of [
      [0, 0, 2],
      [1, 0, 15],
      [2, 0, 7],
      [0, 1, 9],
      [2, 1, 1],
      [0, 2, -5]
    ]) {
      await persist(ProjectMember.build(), {
        projectId: projects[projectIndex].id,
        userId: users[userIndex].id,
        order
      });
    }
    // Членство архивного проекта по-прежнему участвует в персональном порядке.
    await projects[1].destroy();
    service = new ProjectsService(
      Project,
      ProjectMember,
      UserFavorite,
      database,
      new ProjectAccessService(Project, ProjectMember)
    );
  });

  afterAll(async (): Promise<void> => {
    await database?.close();
  });

  it('creates memberships after each maximum and preserves zero defaults and archived positions', async (): Promise<void> => {
    const project = await service.create(
      {
        title: 'Aggregated order',
        prefix: 'ORDERNEW',
        membersIds: users.slice(1).map(user => user.id)
      },
      users[0].id
    );
    const members = await ProjectMember.findAll({
      where: { projectId: project.id },
      order: [['userId', 'ASC']]
    });

    expect(members.map(member => member.order)).toEqual([16, 10, 0, 0]);
  });

  it('reads the caller transaction and does not retain a rolled back maximum', async (): Promise<void> => {
    const countBefore = await ProjectMember.count({
      where: { userId: { [Op.in]: users.map(user => user.id) } }
    });
    const before = await ProjectMember.findAll({
      where: { userId: users[0].id }
    });
    const expected = Math.max(0, ...before.map(member => member.order + 1));
    const transaction = await database.transaction();
    try {
      await ProjectMember.update(
        { order: 100 },
        {
          where: { userId: users[0].id },
          transaction
        }
      );
      const result = await service['getNextMemberOrders'](
        [users[0].id],
        transaction
      );
      expect(result.get(users[0].id)).toBe(101);
    } finally {
      await transaction.rollback();
    }

    const nextTransaction = await database.transaction();
    try {
      const result = await service['getNextMemberOrders'](
        [users[0].id],
        nextTransaction
      );
      expect(result.get(users[0].id)).toBe(expected);
      expect(await service['getNextMemberOrders']([], nextTransaction)).toEqual(
        new Map()
      );
    } finally {
      await nextTransaction.rollback();
    }
    expect(
      await ProjectMember.count({
        where: { userId: { [Op.in]: users.map(user => user.id) } }
      })
    ).toBe(countBefore);
  });
});
