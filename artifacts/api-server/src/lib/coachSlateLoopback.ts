const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function coachSlateApiBase(): string {
  const port = process.env.PORT || "5000";
  return `http://127.0.0.1:${port}/api`;
}

export async function slateLoopbackGet<T>(path: string, attempts = 3): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${coachSlateApiBase()}${path}`, {
        headers: { "x-internal-call": "1" },
      });
      if (r.ok) return (await r.json()) as T;
      const retryable = r.status === 429 || r.status >= 500;
      if (!retryable || i === attempts - 1) {
        await r.text().catch(() => {});
        return null;
      }
      await r.text().catch(() => {});
    } catch {
      if (i === attempts - 1) return null;
    }
    await sleep(300 * 2 ** i + Math.floor(Math.random() * 150));
  }
  return null;
}

export async function slateLoopbackPost<T>(
  path: string,
  body: unknown,
  timeoutMs = 120_000,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(`${coachSlateApiBase()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-call": "1" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!r.ok) {
      await r.text().catch(() => {});
      return null;
    }
    return (await r.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function pooled<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i]!);
    }
  });
  await Promise.all(workers);
}
