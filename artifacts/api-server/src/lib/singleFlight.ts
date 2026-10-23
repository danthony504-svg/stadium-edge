/** Share only in-flight work; never retain a rejected promise or stale result. */
export function createSingleFlight() {
  const pending = new Map<string, Promise<unknown>>();
  return function run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = pending.get(key);
    if (existing) return existing as Promise<T>;
    const work = Promise.resolve().then(task);
    pending.set(key, work);
    const clear = () => { if (pending.get(key) === work) pending.delete(key); };
    void work.then(clear, clear);
    return work;
  };
}
