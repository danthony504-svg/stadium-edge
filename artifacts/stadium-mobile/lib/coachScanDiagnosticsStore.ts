/**
 * In-memory stash of the last Coach board-scan diagnostics.
 *
 * Read-only for the Coach Scan Diagnostics screen. Does not affect scan,
 * scoring, hold, or ticket delivery — callers write a snapshot after the
 * build already finished.
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import type { CoachBoardScanManifest } from "./coachBoardScanManifest.ts";
import { formatCoachBoardScanManifest } from "./coachBoardScanManifest.ts";

export type CoachScanDeliveredPickSummary = {
  game: string;
  market: string;
  pick: string;
  player?: string;
  sport?: string;
  odds?: number;
  isProp?: boolean;
};

export type CoachScanDiagnosticsSnapshot = {
  capturedAt: number;
  askText: string | null;
  requestedLegs: number;
  deliveredLegs: number;
  timedOut: boolean;
  propPoolSize: number;
  note: string;
  deliveredPicks: CoachScanDeliveredPickSummary[];
  manifest: CoachBoardScanManifest | null;
};

type Listener = (snap: CoachScanDiagnosticsSnapshot | null) => void;

let last: CoachScanDiagnosticsSnapshot | null = null;
const listeners = new Set<Listener>();

function slimPick(p: ParsedPick): CoachScanDeliveredPickSummary {
  return {
    game: String(p.game ?? ""),
    market: String(p.market ?? ""),
    pick: String(p.pick ?? ""),
    ...(p.player ? { player: String(p.player) } : {}),
    ...(p.sport ? { sport: String(p.sport) } : {}),
    ...(typeof p.odds === "number" ? { odds: p.odds } : {}),
    ...(typeof p.isProp === "boolean" ? { isProp: p.isProp } : {}),
  };
}

/** Side-effect only — never throws into the Coach build path. */
export function recordCoachScanDiagnostics(input: {
  askText?: string | null;
  requestedLegs: number;
  picks: ParsedPick[];
  note?: string | null;
  timedOut?: boolean;
  propPoolSize?: number;
  manifest?: CoachBoardScanManifest | null;
}): void {
  try {
    const snap: CoachScanDiagnosticsSnapshot = {
      capturedAt: Date.now(),
      askText: input.askText?.trim() ? String(input.askText).trim() : null,
      requestedLegs: Math.max(0, Math.floor(input.requestedLegs || 0)),
      deliveredLegs: input.picks?.length ?? 0,
      timedOut: !!input.timedOut,
      propPoolSize: Math.max(0, Math.floor(input.propPoolSize || 0)),
      note: String(input.note ?? "").trim(),
      deliveredPicks: (input.picks ?? []).map(slimPick),
      manifest: input.manifest ?? null,
    };
    last = snap;
    for (const fn of listeners) {
      try {
        fn(snap);
      } catch {
        /* ignore listener errors */
      }
    }
  } catch {
    /* never disrupt Coach */
  }
}

export function getCoachScanDiagnostics(): CoachScanDiagnosticsSnapshot | null {
  return last;
}

export function clearCoachScanDiagnostics(): void {
  last = null;
  for (const fn of listeners) {
    try {
      fn(null);
    } catch {
      /* ignore */
    }
  }
}

export function subscribeCoachScanDiagnostics(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function formatDeliveredPicks(snap: CoachScanDiagnosticsSnapshot): string[] {
  const lines: string[] = [];
  lines.push("### Delivered on ticket");
  if (!snap.deliveredPicks.length) {
    lines.push("- _(none)_");
    return lines;
  }
  snap.deliveredPicks.forEach((p, i) => {
    const who = p.player ? `${p.player} · ` : "";
    const odds = typeof p.odds === "number" ? ` @ ${p.odds > 0 ? `+${p.odds}` : p.odds}` : "";
    const sport = p.sport ? ` [${p.sport}]` : "";
    const kind = p.isProp ? "prop" : "game";
    lines.push(
      `${i + 1}. **${who}${p.pick}** · ${p.market}${odds}${sport} (${kind}) — ${p.game}`,
    );
  });
  return lines;
}

/** Full copy/paste report for the diagnostics screen. */
export function formatCoachScanDiagnosticsReport(
  snap: CoachScanDiagnosticsSnapshot | null,
): string {
  if (!snap) {
    return [
      "=== Stadium Edge Coach Scan Diagnostics ===",
      "",
      "No Coach board scan recorded yet.",
      "Run a Coach parlay ask (3+ legs), then reopen this screen.",
    ].join("\n");
  }

  const when = new Date(snap.capturedAt).toISOString();
  const lines: string[] = [
    "=== Stadium Edge Coach Scan Diagnostics ===",
    `capturedAt: ${when}`,
    `ask: ${snap.askText ?? "(none)"}`,
    `requestedLegs: ${snap.requestedLegs}`,
    `deliveredLegs: ${snap.deliveredLegs}`,
    `propPoolSize: ${snap.propPoolSize}`,
    `timedOut: ${snap.timedOut ? "yes" : "no"}`,
    "",
  ];

  if (snap.note) {
    lines.push("### Coach note");
    lines.push(snap.note);
    lines.push("");
  }

  lines.push(...formatDeliveredPicks(snap));
  lines.push("");

  if (snap.manifest) {
    lines.push(formatCoachBoardScanManifest(snap.manifest));
  } else {
    lines.push("### Scan manifest");
    lines.push("_No manifest attached to this scan result._");
  }

  lines.push("");
  lines.push(
    "_This screen is read-only. It does not change Coach scan, hold, or delivery._",
  );

  return lines.join("\n");
}
