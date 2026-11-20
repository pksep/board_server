import { Task } from '../model/task.model';
import { TasksService } from '../tasks.service';

/** Создаёт только поля, необходимые для разрешения иерархии. */
function task(
  id: number,
  parentTaskId: number | null
): Pick<Task, 'id' | 'parentTaskId'> {
  return { id, parentTaskId };
}

describe('Task hierarchy root resolution', () => {
  const resolve = TasksService.prototype['findRootTaskId'];

  it('resolves a deep shared chain with linear ancestor lookups', (): void => {
    const size = 5000;
    const nodes = new Map(
      Array.from({ length: size }, (_, index) => [
        index + 1,
        task(index + 1, index || null)
      ])
    );
    const lookup = jest.spyOn(nodes, 'get');
    const roots = new Map<number, number | null>();

    for (let id = size; id > 0; id -= 1) {
      expect(resolve(id, nodes, roots)).toBe(1);
    }

    // Повторные совпадения фильтра не должны заново обходить общих предков.
    expect(lookup.mock.calls.length).toBeLessThanOrEqual(size);
  });

  it('preserves each original ID for a cycle and every path leading into it', (): void => {
    const nodes = new Map([
      [1, task(1, 2)],
      [2, task(2, 1)],
      [3, task(3, 2)],
      [4, task(4, 3)],
      [5, task(5, 5)]
    ]);
    const roots = new Map<number, number | null>();

    for (const id of [4, 1, 3, 2, 5, 4]) {
      expect(resolve(id, nodes, roots)).toBe(id);
    }
  });

  it('keeps a missing ancestor as root and does not reuse results across requests', (): void => {
    const nodes = new Map([[2, task(2, 99)]]);
    const roots = new Map<number, number | null>();
    expect(resolve(2, nodes, roots)).toBe(99);
    expect(resolve(99, nodes, roots)).toBe(99);

    nodes.set(99, task(99, 1));
    nodes.set(1, task(1, null));
    expect(resolve(2, nodes, new Map())).toBe(1);
  });
});
