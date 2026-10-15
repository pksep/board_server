export enum TaskEntityType {
  Product = 'product',
  Assembly = 'cbed',
  Part = 'detal'
}

/** Межсервисная ссылка сохраняет подпись даже после архивации объекта продукции. */
export interface TaskEntityReference {
  type: TaskEntityType;
  id: number;
  name: string;
  designation: string;
}
