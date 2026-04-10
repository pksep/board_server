import { CommandMetadata } from 'nest-commander';

export const CommanderConstants = {
  ACTUAL_KITS_AND_OPERATION_COMMAND: {
    name: 'actual-kits-and-operation',
    description: 'Актуализация наборов и операций'
  }
} as const satisfies Record<string, CommandMetadata>;
