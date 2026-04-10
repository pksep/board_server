import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { getSequelizeConfig } from 'src/configs/postgres.config';
import { getAppModule, getCoreModules } from 'src/configs/modules';
import { User } from 'src/modules/users/model/users.model';

@Module({
  providers: [],
  imports: [
    SequelizeModule.forRootAsync(
      getSequelizeConfig({
        logging: false
      })
    ),
    SequelizeModule.forFeature([User]),
    ...getCoreModules(),
    ...getAppModule()
  ]
})
export class CliModule {}
