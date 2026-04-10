export const processWithPagination = async <T>(
  fetchFunction: (offset: number, limit: number) => Promise<T[]>,
  processFunction: (items: T[]) => Promise<void>,
  pageSize = 100
): Promise<void> => {
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const items = await fetchFunction(offset, pageSize);

    hasMore = items.length > 0;
    if (!hasMore) break;

    await processFunction(items);
    offset += pageSize;
  }
};
