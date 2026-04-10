// Файл, где вы инициализируете Sequelize
import { Sequelize } from 'sequelize';
import * as dotenv from 'dotenv';
import configFactory from '../../configs/env.config';

dotenv.config({
  path: `env/.${process.env.NODE_ENV}.env`
});

export function initializeSequelize() {
  const { url } = configFactory().database;

  const sequelize = new Sequelize(url, {
    dialect: 'postgres'
  });

  return sequelize;
}
