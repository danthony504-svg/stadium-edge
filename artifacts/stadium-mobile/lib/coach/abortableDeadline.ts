/**
 * Race work against a wall-clock deadline and an abort signal.
 * The deadline timer is cleared when work, the deadline, or abort settles
 * so a finished ticket cannot leave a 75s timer holding the session open.
 */
export function raceAbortableDeadline<T, F>(
  work: Promise<T>,
  ms: number,
  signal: AbortSignal,
  fallback: F,
): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  let settled = false;

  const cleanup = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (onAbort) {
      signal.removeEventListener("abort", onAbort);
      onAbort = undefined;
    }
  };

  const gate = new Promise<F>((resolve) => {
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(fallback);
    };
    if (signal.aborted || ms <= 0) {
      finish();
      return;
    }
    timer = setTimeout(finish, ms);
    onAbort = finish;
    signal.addEventListener("abort", onAbort);
  });

  const watched = work.then(
    (value) => {
      if (settled) return fallback;
      settled = true;
      cleanup();
      return value;
    },
    (err: unknown) => {
      if (settled) return fallback;
      settled = true;
      cleanup();
      throw err;
    },
  );

  return Promise.race([watched, gate]);
}

/**
 * Child signal that aborts when the parent aborts or when deadlineAtMs passes.
 * dispose clears the timer. abort stops in-flight work that listens to signal.
 */
export function linkDeadlineAbort(
  parent: AbortSignal,
  deadlineAtMs: number,
): { signal: AbortSignal; abort: () => void; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  const onParent = () => abort();
  if (parent.aborted || Date.now() >= deadlineAtMs) abort();
  else parent.addEventListener("abort", onParent, { once: true });
  const wait = Math.max(0, deadlineAtMs - Date.now());
  const timer = setTimeout(abort, wait);
  return {
    signal: controller.signal,
    abort,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", onParent);
    },
  };
}
