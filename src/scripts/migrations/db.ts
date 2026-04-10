import { Sequelize } from 'sequelize';
import * as dotenv from 'dotenv';
import configFactory from '../../configs/env.config';
import { getEnvFilePaths } from '../../configs/env-paths';

for (const envPath of getEnvFilePaths()) {
  dotenv.config({ path: envPath });
}

export function initializeSequelize() {
  const { url } = configFactory().database;

  const sequelize = new Sequelize(url, {
    dialect: 'postgres'
  });

  return sequelize;
}
