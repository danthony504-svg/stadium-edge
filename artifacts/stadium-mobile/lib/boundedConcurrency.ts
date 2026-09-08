// Bounded concurrency for network fan-out — replaces unbounded Promise.all batches.

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  opts?: { signal?: AbortSignal },
): Promise<R[]> {
  if (!items.length) return [];
  const limit = Math.max(1, concurrency);
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      if (opts?.signal?.aborted) return;
      const index = nextIndex++;
      results[index] = await worker(items[index]!, index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

/** Yield to the event loop so heavy scoring does not monopolize the JS thread. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
