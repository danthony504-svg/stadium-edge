/** Bound optional enrichment, retain settled results, and reserve time for sims. */
export function coachContextBudgetMs(remainingMs: number): number {
  return Math.max(0, Math.min(8_000, remainingMs - 18_000));
}
export async function collectCoachContext<T extends readonly unknown[]>(
  tasks: {
    [K in keyof T]: {
      fallback: T[K];
      run: (signal: AbortSignal) => Promise<T[K]>;
    };
  },
  budgetMs: number,
  parent?: AbortSignal,
): Promise<{ values: T; budgetExpired: boolean }> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const values = tasks.map((t) => t.fallback) as unknown as T;
  let budgetExpired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let grace: ReturnType<typeof setTimeout> | undefined;
  // No work starts when the scoring reserve is already reached.
  if (budgetMs <= 0 || parent?.aborted) {
    parent?.removeEventListener("abort", abort);
    return { values, budgetExpired: !parent?.aborted };
  }
  let closed = false;
  const pending = Promise.all(
    tasks.map(async (task, index) => {
      try {
        const value = await task.run(controller.signal);
        if (!closed) (values as unknown as unknown[])[index] = value;
      } catch {
        /* absent stays absent, never invented */
      }
    }),
  );
  try {
    await Promise.race([
      pending,
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          budgetExpired = true;
          controller.abort();
          resolve();
        }, budgetMs);
      }),
      new Promise<void>((resolve) => {
        if (controller.signal.aborted) resolve();
        else
          controller.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
      }),
    ]);
    // Signal-aware loaders return already completed teams on abort. A short
    // bounded grace retains those results even when another loader ignores abort.
    await Promise.race([
      pending,
      new Promise<void>((resolve) => {
        grace = setTimeout(resolve, 25);
      }),
    ]);
    return { values, budgetExpired };
  } finally {
    closed = true;
    if (timer) clearTimeout(timer);
    if (grace) clearTimeout(grace);
    controller.abort();
    parent?.removeEventListener("abort", abort);
  }
}
