import { Sequelize } from 'sequelize';
import { QueryTypes } from 'sequelize';

export async function isDatabaseEmpty(sequelize: Sequelize): Promise<boolean> {
  const [result] = (await sequelize.query(
    `SELECT COUNT(*)::int AS count 
     FROM information_schema.tables 
     WHERE table_schema = 'public' 
       AND table_type = 'BASE TABLE';`,
    { type: QueryTypes.SELECT }
  )) as any;

  return result.count === 0;
}
