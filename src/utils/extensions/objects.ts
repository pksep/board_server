export function generateObjectPath<T extends object>(
  entity: T,
  prefix = ''
): T {
  return Object.fromEntries(
    Object.entries(entity).map(([key, value]) => [
      key,
      value !== null && typeof value === 'object'
        ? generateObjectPath(value, `${prefix}${key}.`)
        : `${prefix}${key}`
    ])
  ) as T;
}
