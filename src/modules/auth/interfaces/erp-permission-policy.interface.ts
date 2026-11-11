/** Политика экрана ERP для чтения межпроектных проекций Board. */
export interface ErpPermissionPolicy {
  requirements: { resource: string; action: string }[];
  mode: 'allOf' | 'anyOf';
  sessionMessage: string;
  unavailableMessage: string;
  deniedMessage: string;
  requiredMessage: string;
}
