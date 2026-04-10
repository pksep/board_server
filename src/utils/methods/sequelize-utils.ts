import { Transaction } from 'sequelize';

export const attachEntities = async <T>(
  entity: any,
  relationKey: keyof T,
  relatedIds: number[],
  transaction: Transaction
): Promise<void> => {
  try {
    const relatedEntities = entity[relationKey];

    if (Array.isArray(relatedEntities)) {
      for (const relatedEntity of relatedEntities) {
        if (!relatedIds.includes(relatedEntity.id)) {
          await entity.$remove(relationKey as string, relatedEntity.id, {
            transaction
          });
        }
      }
    }

    for (const relatedId of relatedIds) {
      await entity.$add(relationKey as string, relatedId, { transaction });
    }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
};
