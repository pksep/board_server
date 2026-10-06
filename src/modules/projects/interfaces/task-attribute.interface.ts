/** Поддерживаемые типы пользовательских атрибутов задачи. */
export enum TaskAttributeType {
  Boolean = 'boolean',
  Participants = 'participants',
  Date = 'date',
  Text = 'text',
  Number = 'number'
}

/** Определение пользовательского атрибута, действующее для всего проекта. */
export interface ITaskAttributeDefinition {
  id: string;
  name: string;
  type: TaskAttributeType;
}

/** Значение пользовательского атрибута одной задачи. */
export type TTaskAttributeValue = boolean | number | string | number[] | null;

/** Набор значений пользовательских атрибутов одной задачи. */
export type TTaskAttributeValues = Record<string, TTaskAttributeValue>;
