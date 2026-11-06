import type { FieldChange } from '@pksep/contracts';
import type { IErpUserEvent } from '../interfaces/erp-user-event.interface';

export function isEventRecord(
  value: unknown
): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Проверяет событие целиком до чтения или изменения пользователя. */
export function normalizeErpUserEvent(
  event: unknown,
  type: string
): IErpUserEvent {
  if (!isEventRecord(event) || !isEventRecord(event.entity))
    throw new Error('User event must contain an entity');

  const entity = event.entity;
  const id = entity.id;
  if ((typeof id !== 'number' && typeof id !== 'string') || !String(id).trim())
    throw new Error('User event must contain an ERP user id');

  switch (type) {
    case 'create':
      return {
        type,
        entity: {
          ...entity,
          id,
          ex: isEventRecord(entity.ex) ? entity.ex : undefined
        }
      };
    case 'change': {
      const fields = entity.changedFields ?? entity.changeFields ?? [];
      if (!Array.isArray(fields))
        throw new Error('User change event must contain a field array');

      const changeFields: FieldChange[] = fields.map((field: unknown) => {
        if (!isEventRecord(field) || typeof field.fieldName !== 'string')
          throw new Error('User change event contains an invalid field');

        return {
          fieldName: field.fieldName,
          lastValue: field.lastValue,
          currentValue: field.currentValue
        };
      });

      return { type, entity: { id, changeFields } };
    }
    case 'delete':
      return { type, entity: { id } };
    case 'ban': {
      const banned =
        typeof entity.banned === 'boolean' ? entity.banned : entity.ban;
      if (typeof banned !== 'boolean')
        throw new Error('User ban event must contain a boolean state');

      return { type, entity: { id, banned } };
    }
    default:
      throw new Error(`Unsupported user event type: ${type}`);
  }
}
