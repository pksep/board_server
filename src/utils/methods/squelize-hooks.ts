import { Transaction } from 'sequelize';

/***
 * After commit hooks
 * Функция помогает добиться желаемого поведения при транзакции и без нее
 */
export const afterCommitHooks = async (
  transaction: Transaction,
  fc: () => Promise<any>,
  cb = (result: any): Promise<any> => result
) => {
  try {
    if (!transaction) return cb(await fc());

    transaction.afterCommit(async () => {
      cb(await fc());
    });
  } catch (error) {
    throw new Error(error);
  }
};
