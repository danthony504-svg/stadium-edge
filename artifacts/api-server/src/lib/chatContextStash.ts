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

/**
 * Resolve the Coach request context: prefer a valid contextStashId payload
 * (large mobile builds omit inline `context`), else the inline body context.
 * Callers MUST use the returned context for lockedContext — never leave the
 * stash loaded into a throwaway variable while the model reads empty inline
 * context (that drops live realProps/realOdds/fightAnalysis/tennisAnalysis).
 */
export function resolveChatRequestContext(args: {
  inlineContext: Record<string, unknown> | undefined;
  contextStashId?: string | null;
}):
  | { ok: true; context: Record<string, unknown> | undefined; fromStash: boolean }
  | { ok: false; reason: "expired" } {
  const stashId =
    typeof args.contextStashId === "string" ? args.contextStashId.trim() : "";
  if (stashId) {
    const stashed = getChatContextStash(stashId);
    if (!stashed) return { ok: false, reason: "expired" };
    return { ok: true, context: stashed, fromStash: true };
  }
  return { ok: true, context: args.inlineContext, fromStash: false };
}
