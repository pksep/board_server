import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import * as path from 'path';

@Injectable()
export class AppInitService implements OnApplicationBootstrap {
  constructor(private readonly sequelize: Sequelize) {}

  async onApplicationBootstrap() {
    const isInit = process.env.INIT_SEP === 'true';
    if (!isInit) return;

    console.log(`Seeding process started...`);
    try {
      await this.seedsPool();
    } catch (err) {
      console.error(err);
    }
  }

  private async seedsPool() {
    try {
      /**
       * !!! ЗДЕСЬ ВАЖНА ОЧЕРЕДНОСТЬ !!!
       */
      const seeds = [
        {
          description: 'Добавляем админа',
          path: '20240302213411-users-init'
        }
      ];

      for (const seed of seeds) {
        await this.executeSeed(seed);
      }
      console.log('All seeds have been successfully executed');
    } catch (err) {
      console.error(err);
    }
  }

  private async executeSeed(seed: { description: string; path: string }) {
    try {
      const seedPath = path.join(
        __dirname,
        '..',
        '..',
        '..',
        'seeders',
        `${seed.path}.js`
      );
      const seedModule = await import(seedPath);
      await seedModule.up(this.sequelize.getQueryInterface(), this.sequelize);
      console.log(`✅ [SUCCESS]: ${seed.description}`);
    } catch (err) {
      console.log(`❌ [ERROR]: ${seed.description}`);
      console.log(err);
    }
  }
}
