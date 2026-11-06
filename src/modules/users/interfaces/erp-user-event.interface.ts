import type { EntityChangePayload, EntityEvent } from '@pksep/contracts';
import type { IErpUserCreatePayload } from './erp-user-create-event.interface';

export type SyncableUserField =
  | 'initial'
  | 'login'
  | 'serviceNumber'
  | 'image'
  | 'ban'
  | 'role';

export interface IErpUserChangePayload extends Omit<EntityChangePayload, 'id'> {
  id: number | string;
}

export type IErpUserEvent =
  | { type: 'create'; entity: IErpUserCreatePayload }
  | { type: 'change'; entity: IErpUserChangePayload }
  | { type: 'delete'; entity: { id: number | string } }
  | { type: 'ban'; entity: { id: number | string; banned: boolean } };

export type IErpUserChangeEvent = Pick<
  EntityEvent<IErpUserChangePayload>,
  'entity'
>;
