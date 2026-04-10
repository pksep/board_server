/**
 * Упрощает добавление поля в запрос sequelie 
 * @param conditions 
 * @param query 
 * @returns 
 * 
 * @example
 * id: {
      [Op.in]: filterByOnly.cbedIds,
      ...(filterByOnly.cbedIds.length > 0
        ? { id: { [Op.in]: filterByOnly.cbedIds } }
        : {})
    }
    TO:
    ...addFieldByCondition(filterByOnly.cbedIds.length, {
      id: { [Op.in]: filterByOnly.cbedIds }
    })
 */
export const addFieldByCondition = (conditions: any, query: any) =>
  conditions ? query : {};
