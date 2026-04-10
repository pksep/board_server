import {
  FindAttributeOptions,
  IncludeOptions,
  Transaction,
  WhereOptions
} from 'sequelize';
import { ICreateActionResponse } from 'src/modules/actions/interfaces/action.interface';

export interface IByQuery {
  attributes: FindAttributeOptions;
  include?: IncludeOptions[];
  where?: WhereOptions;
  offset?: number;
  limit?: number;
  transaction?: Transaction;
}

export type TActionCreateOption =
  | {
      action: ICreateActionResponse;
      userId?: never;
    }
  | {
      userId: number;
      action?: never;
    };

export interface ITrasactionOption {
  transaction?: Transaction;
}
