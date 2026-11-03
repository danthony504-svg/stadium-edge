/** Own both settlement and cancellation, even when a dependency ignores abort. */
export class CoachWorkTimeout extends Error {
  constructor() { super('Coach work deadline reached'); this.name = 'CoachWorkTimeout'; }
}
export async function runCoachBounded<T>(work: (signal: AbortSignal) => Promise<T>, budgetMs: number, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let rejectStop!: (reason: Error) => void;
  const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
  const stop = (reason: Error) => { rejectStop(reason); controller.abort(); };
  const cancel = () => { const error = new Error('Coach work cancelled'); error.name = 'AbortError'; stop(error); };
  if (parent?.aborted) { const error = new Error('Coach work cancelled'); error.name = 'AbortError'; throw error; }
  if (budgetMs <= 0) throw new CoachWorkTimeout();
  parent?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => stop(new CoachWorkTimeout()), budgetMs);
  try { return await Promise.race([stopped, Promise.resolve().then(() => {
    if (controller.signal.aborted) throw new Error('Coach work stopped before start');
    return work(controller.signal);
  })]); }
  finally { clearTimeout(timer); parent?.removeEventListener('abort', cancel); controller.abort(); }
}
