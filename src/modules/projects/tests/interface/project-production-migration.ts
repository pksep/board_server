import type { DataTypes, QueryInterface } from 'sequelize';

export interface IProjectProductionMigration {
  up: (
    queryInterface: QueryInterface,
    types: typeof DataTypes
  ) => Promise<void>;
  down: (queryInterface: QueryInterface) => Promise<void>;
}
