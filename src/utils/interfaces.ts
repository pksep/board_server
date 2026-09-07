import {
  FindAttributeOptions,
  IncludeOptions,
  Transaction,
  WhereOptions
} from 'sequelize';

export interface IByQuery {
  attributes: FindAttributeOptions;
  include?: IncludeOptions[];
  where?: WhereOptions;
  offset?: number;
  limit?: number;
  transaction?: Transaction;
}

export interface ITrasactionOption {
  transaction?: Transaction;
}
