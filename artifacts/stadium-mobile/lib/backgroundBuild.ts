// Pure, dependency-free helpers for the Coach background-finish / replay flow.
//
// When a parlay build is in flight and the user backgrounds the app, the phone's
// socket dies and an in-app stream would stall. Instead the SERVER finishes the
// ticket and pushes when ready; on return the client "replays" it by marrying a
// locally-saved build context (the same odds/props the model saw) with the
// server's stashed reply — with ZERO re-fetching and ZERO fabrication.
//
// These helpers are extracted from app/(tabs)/coach.tsx so the subtle
// backgrounding-mid-build path can be unit-tested under `node --test`. NONE of
// them fetch, call the model, or invent data: they only generate the build id,
// (de)serialize the pending record, and decide WHEN/WHETHER to hand off and how
// to assemble the replay from real pieces. Honesty is preserved by construction —
// a missing/failed half yields a non-replay decision, never a fabricated ticket.

// Generate an opaque, locally-unique build id tying a PendingBuild to the
// server's stash. Time-prefixed so it is roughly ordered, plus random entropy.
export function makeBuildId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// Serialize a pending build for AsyncStorage. Plain JSON — the record is only
// real, already-fetched context (no functions/cycles).
export function serializePendingBuild(b: unknown): string {
  return JSON.stringify(b);
}

// Parse a pending build back out of storage. Returns null on missing or corrupt
// data so the caller falls back to a normal (non-replay) flow rather than
// throwing or replaying garbage.
export function deserializePendingBuild<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// A build is eligible to keep finishing on the server (and thus to be handed off
// when the app is backgrounded) only when it is a parlay BUILD *and* the user is
// signed in — the server stash is per-user. A non-parlay chat or an anonymous
// user just streams in-app and aborts normally on background.
export function shouldHandOffBuild(opts: {
  isParlayBuild: boolean;
  isSignedIn: boolean;
}): boolean {
  return opts.isParlayBuild && opts.isSignedIn;
}

// On an AppState "background" event: hand THIS attempt off (abort its about-to-
// freeze socket, but DON'T discard it — the server keeps going) only when a
// stream is actually in flight AND it was started as a background-eligible
// build. Otherwise there is nothing to hand off and we let it abort normally.
export function shouldAbortForHandoff(opts: {
  streaming: boolean;
  hasPendingBackground: boolean;
}): boolean {
  return opts.streaming && opts.hasPendingBackground;
}

// The minimal shape of a locally-saved pending build the restore logic needs.
// `createdAt` (epoch ms) lets the restore decide when a build that never came
// back has waited long enough to be treated as a stall (see decideBackgroundRestore).
export type PendingBuildShape<TContext, TProp, TMeta> = {
  buildId: string;
  userText: string;
  context: TContext;
  propPool: TProp[];
  gameMeta: TMeta[];
  todayOnly: boolean;
  createdAt: number;
};

// The minimal shape of the server's stashed build result.
export type CoachBuildStashShape<TStashProp> = {
  buildId: string;
  status?: "ready" | "timedOut" | "failed";
  full: string;
  props?: TStashProp[];
};

// The exact payload replayed through the normal parse/render path. `full` and
// `props` come VERBATIM from the server stash; the context pieces come from the
// local pending record — both halves are real, nothing is fetched or invented.
export type ReplayPayload<TContext, TProp, TMeta, TStashProp> = {
  full: string;
  props: TStashProp[];
  context: TContext;
  propPool: TProp[];
  gameMeta: TMeta[];
  todayOnly: boolean;
};

export type BackgroundRestoreDecision<TContext, TProp, TMeta, TStashProp> =
  // Local pending record missing or for a different build → can only rebuild on
  // the device the build was started on.
  | { action: "wrong-device" }
  // Stash not yet written, for a different build, or still empty → not ready;
  // retry later (notification tap / next foreground).
  | { action: "not-ready" }
  // Server recorded a terminal failure and stashed NO ticket (honesty). Surface
  // a recovery message carrying the original prompt for a "Try again".
  | { action: "failed"; status: "timedOut" | "failed"; retryText: string }
  // Both halves present → replay the real result, no model re-call.
  | { action: "replay"; payload: ReplayPayload<TContext, TProp, TMeta, TStashProp> };

// Decide what to do with a background-finished build, given the locally-saved
// pending record and the server's stash. Pure: takes already-loaded data and
// returns a decision; the caller performs the side effects (messages, clearing
// storage, the actual replay). Mirrors restoreBackgroundBuild's decision tree.
export function decideBackgroundRestore<TContext, TProp, TMeta, TStashProp>(
  buildId: string,
  pending: PendingBuildShape<TContext, TProp, TMeta> | null | undefined,
  stash: CoachBuildStashShape<TStashProp> | null | undefined,
  // `now` + `maxWaitMs` let a build whose stash NEVER arrives stop hanging on an
  // endless "still building" line: once we've waited longer than a real build
  // could take, a missing/empty stash is treated as a stall (timedOut) so the
  // caller can offer a retry. Omit them to keep the original wait-forever behavior.
  opts?: { now?: number; maxWaitMs?: number },
): BackgroundRestoreDecision<TContext, TProp, TMeta, TStashProp> {
  if (!pending || pending.buildId !== buildId) return { action: "wrong-device" };
  // A terminal status the server actually recorded always wins (honest failure).
  if (stash && stash.buildId === buildId && (stash.status === "failed" || stash.status === "timedOut")) {
    return { action: "failed", status: stash.status, retryText: pending.userText };
  }
  // A real, non-empty result is ready to replay.
  if (stash && stash.buildId === buildId && stash.full.trim()) {
    return {
      action: "replay",
      payload: {
        full: stash.full,
        props: stash.props ?? [],
        context: pending.context,
        propPool: pending.propPool,
        gameMeta: pending.gameMeta,
        todayOnly: pending.todayOnly,
      },
    };
  }
  // The stash is missing, for a different build, or still empty. If we've now
  // waited longer than a build could reasonably take, the server build never
  // made it back (it died on the dropped socket and there's no keep-warm/sweeper
  // to finish it) — treat it as a stall so the user gets a retry, not a forever
  // "still building". We never fabricate a ticket; this only ends the wait.
  if (
    opts?.now != null &&
    opts?.maxWaitMs != null &&
    pending.createdAt != null &&
    pending.createdAt + opts.maxWaitMs <= opts.now
  ) {
    return { action: "failed", status: "timedOut", retryText: pending.userText };
  }
  return { action: "not-ready" };
}
