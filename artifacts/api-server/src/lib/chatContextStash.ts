/** Short-lived in-memory stash so mobile can upload build context once, then stream with a tiny body. */

type StashEntry = {
  context: Record<string, unknown>;
  expiresAt: number;
};

const STASH_TTL_MS = 15 * 60_000;
const MAX_ENTRIES = 400;

const stash = new Map<string, StashEntry>();

function prune(): void {
  const now = Date.now();
  for (const [id, entry] of stash) {
    if (entry.expiresAt <= now) stash.delete(id);
  }
  if (stash.size <= MAX_ENTRIES) return;
  const drop = stash.size - MAX_ENTRIES;
  let n = 0;
  for (const id of stash.keys()) {
    stash.delete(id);
    if (++n >= drop) break;
  }
}

export function putChatContextStash(
  stashId: string,
  context: Record<string, unknown>,
): void {
  prune();
  stash.set(stashId, { context, expiresAt: Date.now() + STASH_TTL_MS });
}

/** Read stashed context (kept until TTL so streamChat retries can reuse it). */
export function getChatContextStash(stashId: string): Record<string, unknown> | null {
  const entry = stash.get(stashId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    stash.delete(stashId);
    return null;
  }
  return entry.context;
}
