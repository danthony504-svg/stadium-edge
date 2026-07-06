// Single source of truth for frozen game-line display across summary, cards,
// breakdown, slip, and share. No line re-selection — read display snapshot only.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { RealOddsEntry } from "./api.ts";
import { resolvePickEdgePct } from "./parlayQualifiedGate.ts";

function isGameLinePick(pick: { isProp?: boolean; market: string }): boolean {
  if (pick.isProp) return false;
  const m = String(pick.market ?? "").toLowerCase();
  if (/moneyline|\bml\b/.test(m)) return true;
  if (/spread/.test(m)) return true;
  if (/total|over\/under|o\/u/.test(m)) return true;
  return false;
}

export type FrozenGameLineDisplay = {
  pick: string;
  market: string;
  odds: number;
  game: string;
  grade: string | null;
  confidencePct: number | null;
  edgePct: number | null;
  evPct: number | null;
  simHit: number | null;
  simPct: number | null;
};

export type FrozenGameLineRow = FrozenGameLineDisplay & {
  gameKey: string;
};

export class FrozenGameLineConsistencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrozenGameLineConsistencyError";
  }
}

export const normGameLabel = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normPickLabel = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export function isGameLineFrozen(pick: ParsedPick): boolean {
  return (
    !pick.isProp &&
    isGameLinePick(pick) &&
    pick.gameLineFrozen === true &&
    pick.gameLineFinal?.frozenAt != null &&
    pick.gameLineFinal.display != null
  );
}

/** Header fields every surface must read from the frozen snapshot. */
export function frozenGameLineHeader(pick: ParsedPick): {
  game: string;
  market: string;
  pick: string;
  odds: number;
} {
  const d = pick.gameLineFinal?.display;
  if (isGameLineFrozen(pick) && d) {
    return { game: d.game, market: d.market, pick: d.pick, odds: d.odds };
  }
  return { game: pick.game, market: pick.market, pick: pick.pick, odds: pick.odds };
}

export function getFrozenGameLineLegs(picks: ParsedPick[]): FrozenGameLineRow[] {
  const rows: FrozenGameLineRow[] = [];
  const seen = new Set<string>();
  for (const pick of picks) {
    if (!isGameLinePick(pick) || pick.isProp) continue;
    const header = frozenGameLineHeader(pick);
    const gameKey = normGameLabel(header.game);
    if (seen.has(gameKey)) continue;
    seen.add(gameKey);
    const d = pick.gameLineFinal?.display;
    rows.push({
      gameKey,
      game: header.game,
      market: header.market,
      pick: header.pick,
      odds: header.odds,
      grade: d?.grade ?? pick.finalAiScore?.grade ?? null,
      confidencePct: d?.confidencePct ?? pick.finalAiScore?.confidencePct ?? null,
      edgePct: d?.edgePct ?? null,
      evPct: d?.evPct ?? null,
      simHit: d?.simHit ?? pick.finalAiScore?.simHit ?? null,
      simPct:
        d?.simPct ??
        (d?.simHit != null && Number.isFinite(d.simHit)
          ? Math.round(d.simHit * 100)
          : pick.finalAiScore?.simHit != null
            ? Math.round(pick.finalAiScore.simHit * 100)
            : null),
    });
  }
  return rows;
}

function teamFromPickLabel(label: string): string | null {
  const p = String(label ?? "").trim();
  if (!p || /\b(over|under)\b/i.test(p)) return null;
  const m = p.match(/^(.+?)\s*[+-]\d/);
  if (m) return m[1]!.trim();
  return p.replace(/\s*ML$/i, "").trim() || null;
}

function teamsInGameLabel(game: string): { away: string; home: string } {
  const parts = String(game ?? "").split(" @ ");
  return { away: (parts[0] ?? "").trim(), home: (parts[1] ?? "").trim() };
}

function teamsMatch(a: string, b: string): boolean {
  const x = normGameLabel(a);
  const y = normGameLabel(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const ax = new Set(x.split(" ").filter((w) => w.length > 2));
  return y.split(" ").some((w) => w.length > 2 && ax.has(w));
}

function isOpposingTeamPick(game: string, pickA: string, pickB: string): boolean {
  const teamA = teamFromPickLabel(pickA);
  const teamB = teamFromPickLabel(pickB);
  if (!teamA || !teamB || normPickLabel(teamA) === normPickLabel(teamB)) return false;
  const { away, home } = teamsInGameLabel(game);
  const aSide =
    teamsMatch(teamA, away) ? "away" : teamsMatch(teamA, home) ? "home" : null;
  const bSide =
    teamsMatch(teamB, away) ? "away" : teamsMatch(teamB, home) ? "home" : null;
  return aSide != null && bSide != null && aSide !== bSide;
}

export type FrozenGameLineRequiredMetrics = {
  grade: string;
  simPct: number;
  edgePct: number;
  confidencePct: number;
};

const PLACEHOLDER = /^[—-]+$/;

function isRealGrade(grade: string | null | undefined): grade is string {
  return !!grade && grade.trim() !== "" && !PLACEHOLDER.test(grade.trim());
}

/** Resolve the four metrics every game-line surface must show from frozen display + fallbacks. */
export function resolveFrozenGameLineMetrics(
  pick: ParsedPick,
  realOdds?: RealOddsEntry[],
): FrozenGameLineRequiredMetrics | null {
  const d = pick.gameLineFinal?.display;
  const s = pick.finalAiScore;
  const rubric = pick.scores ?? s?.rubric ?? null;
  const grade = d?.grade ?? s?.grade ?? rubric?.grade ?? null;
  const confidencePct = d?.confidencePct ?? s?.confidencePct ?? rubric?.confidencePct ?? null;
  let edgePct = d?.edgePct ?? s?.edgePct ?? rubric?.edgePct ?? null;
  if ((edgePct == null || !Number.isFinite(edgePct)) && realOdds?.length) {
    edgePct = resolvePickEdgePct(pick, { realOdds });
  }
  const simHit = d?.simHit ?? s?.simHit ?? null;
  const simPct =
    d?.simPct ??
    (simHit != null && Number.isFinite(simHit) ? Math.round(simHit * 100) : null);

  if (
    !isRealGrade(grade) ||
    simPct == null ||
    !Number.isFinite(simPct) ||
    edgePct == null ||
    !Number.isFinite(edgePct) ||
    edgePct <= 0 ||
    confidencePct == null ||
    !Number.isFinite(confidencePct)
  ) {
    return null;
  }
  return { grade, simPct, edgePct, confidencePct };
}

/** Throw when any required game-line metric is missing — never render placeholder dashes. */
export function assertFrozenGameLineMetricsComplete(
  pick: ParsedPick,
  realOdds?: RealOddsEntry[],
): FrozenGameLineRequiredMetrics {
  const d = pick.gameLineFinal?.display;
  const header = frozenGameLineHeader(pick);
  const missing: string[] = [];
  const metrics = resolveFrozenGameLineMetrics(pick, realOdds);
  if (!metrics) {
    if (!isRealGrade(d?.grade ?? pick.finalAiScore?.grade)) missing.push("Final AI Grade");
    const simHit = d?.simHit ?? pick.finalAiScore?.simHit;
    if (simHit == null || !Number.isFinite(simHit)) missing.push("Simulation %");
    const edge = d?.edgePct ?? pick.finalAiScore?.edgePct;
    if (edge == null || !Number.isFinite(edge) || edge <= 0) missing.push("Edge %");
    const conf = d?.confidencePct ?? pick.finalAiScore?.confidencePct;
    if (conf == null || !Number.isFinite(conf)) missing.push("Confidence");
    throw new FrozenGameLineConsistencyError(
      `Game line ${header.pick} (${header.game}) missing ${missing.join(", ")} — refusing incomplete metadata`,
    );
  }
  return metrics;
}

function assertSummaryHasNoPlaceholderDashes(summary: string): void {
  if (/Final AI\s*[—-]{1,2}|edge\s*[—-]{1,2}|sim\s*[—-]{1,2}|conf(?:idence)?\s*[—-]{1,2}/i.test(summary)) {
    throw new FrozenGameLineConsistencyError(
      "Game-line summary contains placeholder dashes — build refused",
    );
  }
}

export function assertAllFrozenGameLineMetrics(
  picks: ParsedPick[],
  realOdds?: RealOddsEntry[],
): void {
  for (const pick of picks) {
    if (!isGameLinePick(pick) || pick.isProp) continue;
    assertFrozenGameLineMetricsComplete(pick, realOdds);
  }
}

/** Format one frozen leg for the Coach summary — never re-runs line selection. */
export function formatFrozenGameLineSummaryLine(
  row: FrozenGameLineRow,
  pick: ParsedPick,
  realOdds?: RealOddsEntry[],
): string {
  if (!pick.gameLineFinal) {
    throw new FrozenGameLineConsistencyError(
      `Game line ${row.pick} (${row.game}) is not finalized`,
    );
  }
  const metrics = assertFrozenGameLineMetricsComplete(pick, realOdds);
  const header = `**${row.pick}** (${row.market}) · ${row.game}`;
  const metricsLine = `Final AI ${metrics.grade} · Sim ${metrics.simPct}% · Edge +${metrics.edgePct.toFixed(1)}% · Conf ${metrics.confidencePct}`;
  const bullets = pick.gameLineFinal.bullets ?? [];
  const why =
    bullets.length > 0
      ? `Selected because:\n${bullets.map((b) => `  • ${b}`).join("\n")}`
      : pick.gameLineFinal.reason
        ? `Selected because: ${pick.gameLineFinal.reason}`
        : "";
  return why ? `${header}\n${metricsLine}\n${why}` : `${header}\n${metricsLine}`;
}

/**
 * Build the game-line portion of legNote from frozen snapshots only.
 * Returns empty string when there are no qualified frozen game lines.
 */
export function buildFrozenGameLineSummaryNote(
  picks: ParsedPick[],
  realOdds?: RealOddsEntry[],
): string {
  const rows = getFrozenGameLineLegs(picks);
  if (!rows.length) return "";

  const pickByGame = new Map<string, ParsedPick>();
  for (const pick of picks) {
    if (!isGameLinePick(pick) || pick.isProp) continue;
    pickByGame.set(normGameLabel(frozenGameLineHeader(pick).game), pick);
  }

  const lines: string[] = [];
  for (const row of rows) {
    const pick = pickByGame.get(row.gameKey);
    if (!pick) continue;
    lines.push(formatFrozenGameLineSummaryLine(row, pick, realOdds));
  }

  if (!lines.length) return "";
  const intro = `_After the 10k sim, ${lines.length} qualified game line${lines.length === 1 ? "" : "s"} — every line shows Final AI Grade, Simulation %, Edge %, and Confidence from the frozen pick:_`;
  const summary = `${intro}\n\n${lines.map((n) => `• ${n}`).join("\n\n")}`;
  assertSummaryHasNoPlaceholderDashes(summary);
  return summary;
}

/** Parse game/pick/market tuples from frozen summary bullets. */
export function parseFrozenSummaryGamePicks(summaryNote: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of parseAllGameLineMentionsFromNote(summaryNote).values()) {
    out.set(row.gameKey, normPickLabel(row.pick));
  }
  return out;
}

export type GameLineMention = {
  gameKey: string;
  game: string;
  pick: string;
  market: string;
};

/** Parse every game-line mention in legNote — frozen bullets and legacy optimizer lines. */
export function parseAllGameLineMentionsFromNote(note: string): Map<string, GameLineMention> {
  const out = new Map<string, GameLineMention>();
  if (!note.trim()) return out;

  for (const rawLine of note.split(/\n/)) {
    const trimmed = rawLine.trim().replace(/^[•*-]\s+/, "");
    if (!trimmed || !/@/.test(trimmed)) continue;

    const frozen = trimmed.match(/\*\*([^*]+)\*\*\s*\(([^)]+)\)\s*·\s*(.+)$/);
    if (frozen) {
      const game = frozen[3]!.trim();
      const gameKey = normGameLabel(game);
      out.set(gameKey, {
        gameKey,
        game,
        pick: frozen[1]!.trim(),
        market: frozen[2]!.trim(),
      });
      continue;
    }

    const legacy = trimmed.match(/^(.+@\s*.+?):\s*(.+?)\s*\(([^)]+)\)/);
    if (legacy) {
      const game = legacy[1]!.trim();
      const gameKey = normGameLabel(game);
      out.set(gameKey, {
        gameKey,
        game,
        pick: legacy[2]!.trim(),
        market: legacy[3]!.trim(),
      });
    }
  }
  return out;
}

function looksLikeGameLineListing(text: string): boolean {
  const t = text.trim();
  if (!t || !/@/.test(t)) return false;
  if (/\*\*[^*]+\*\*\s*\([^)]+\)\s*·\s*.+@/.test(t)) return true;
  if (/\((?:Alt )?(?:Spread|Moneyline|ML|Total)\)/i.test(t)) return true;
  if (/:\s*.+\s*\((?:Alt )?(?:Spread|Moneyline|ML|Total)\)/i.test(t)) return true;
  if (/Final AI\s*[:—-]/i.test(t) && /@/.test(t)) return true;
  if (/edge\s*:\s*[—-]{1,2}/i.test(t) && /@/.test(t)) return true;
  return false;
}

/** Remove model / legacy optimizer listings so only frozen summary remains. */
export function stripModelGameLineListings(note: string): string {
  if (!note.trim()) return "";
  const parts = note.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (looksLikeGameLineListing(p)) continue;
    if (/^After the 10k sim,/i.test(p)) continue;
    const lines = p
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !looksLikeGameLineListing(l));
    if (!lines.length) continue;
    const joined = lines.join("\n");
    if (looksLikeGameLineListing(joined)) continue;
    out.push(joined);
  }
  return out.join("\n\n");
}

function ticketGameLineCards(picks: ParsedPick[]): Map<string, ParsedPick> {
  const byGame = new Map<string, ParsedPick>();
  for (const pick of picks) {
    if (!isGameLinePick(pick) || pick.isProp) continue;
    const header = frozenGameLineHeader(pick);
    const key = normGameLabel(header.game);
    const prev = byGame.get(key);
    if (prev) {
      const prevHeader = frozenGameLineHeader(prev);
      if (isOpposingTeamPick(header.game, header.pick, prevHeader.pick)) {
        throw new FrozenGameLineConsistencyError(
          `Opposing sides on ${header.game}: "${prevHeader.pick}" vs "${header.pick}"`,
        );
      }
      throw new FrozenGameLineConsistencyError(
        `Duplicate game-line legs on ${header.game}: "${prevHeader.pick}" and "${header.pick}"`,
      );
    }
    byGame.set(key, pick);
  }
  return byGame;
}

/**
 * Hard fail before render when frozen ticket surfaces would disagree.
 * Validates card ↔ summary ↔ slip ↔ breakdown ↔ share for every game-line leg.
 * Throws FrozenGameLineConsistencyError on any mismatch.
 */
export function assertFrozenTicketConsistency(
  picks: ParsedPick[],
  legNote?: string,
): void {
  const byGame = ticketGameLineCards(picks);

  for (const pick of byGame.values()) {
    if (!isGameLineFrozen(pick)) {
      throw new FrozenGameLineConsistencyError(
        `Game line on ${pick.game} is not frozen — summary and cards cannot diverge safely`,
      );
    }
    assertFrozenGameLineMetricsComplete(pick);
    const header = frozenGameLineHeader(pick);
    const display = pick.gameLineFinal!.display!;
    if (
      normPickLabel(pick.pick) !== normPickLabel(display.pick) ||
      normPickLabel(header.pick) !== normPickLabel(display.pick) ||
      normGameLabel(pick.game) !== normGameLabel(display.game) ||
      normPickLabel(header.market) !== normPickLabel(display.market)
    ) {
      throw new FrozenGameLineConsistencyError(
        `Frozen display mismatch on ${pick.game}: card="${header.pick}" snapshot="${display.pick}"`,
      );
    }

    const surfaces = frozenLegSurfaceLabels(pick);
    const canonical = surfaces.card;
    if (
      surfaces.slip !== canonical ||
      surfaces.breakdown !== canonical ||
      surfaces.share !== canonical
    ) {
      throw new FrozenGameLineConsistencyError(
        `Surface label mismatch on ${pick.game}: card/slip/breakdown/share must match`,
      );
    }
  }

  if (legNote == null || !legNote.trim()) {
    if (byGame.size > 0) {
      throw new FrozenGameLineConsistencyError(
        "Ticket has game-line cards but legNote has no frozen summary",
      );
    }
    return;
  }

  const mentioned = parseAllGameLineMentionsFromNote(legNote);

  if (mentioned.size > 0 && byGame.size === 0) {
    const orphan = [...mentioned.values()][0]!;
    throw new FrozenGameLineConsistencyError(
      `Summary lists ${orphan.pick} (${orphan.market}) for ${orphan.game} but no game-line card is on the ticket`,
    );
  }

  for (const [gameKey, mention] of mentioned) {
    const card = byGame.get(gameKey);
    if (!card) {
      throw new FrozenGameLineConsistencyError(
        `Summary lists ${mention.pick} for ${mention.game} but no matching game-line card is on the ticket`,
      );
    }
    const header = frozenGameLineHeader(card);
    if (normPickLabel(mention.pick) !== normPickLabel(header.pick)) {
      throw new FrozenGameLineConsistencyError(
        `Summary vs card mismatch on ${header.game}: summary="${mention.pick}" card="${header.pick}"`,
      );
    }
    if (normPickLabel(mention.market) !== normPickLabel(header.market)) {
      throw new FrozenGameLineConsistencyError(
        `Summary vs card market mismatch on ${header.game}: summary="${mention.market}" card="${header.market}"`,
      );
    }
    if (isOpposingTeamPick(header.game, mention.pick, header.pick)) {
      throw new FrozenGameLineConsistencyError(
        `Summary backs opposing side on ${header.game}: summary="${mention.pick}" card="${header.pick}"`,
      );
    }
  }

  for (const [gameKey, card] of byGame) {
    const header = frozenGameLineHeader(card);
    const mention = mentioned.get(gameKey);
    if (!mention) {
      throw new FrozenGameLineConsistencyError(
        `Game-line card ${header.pick} (${header.market}) on ${header.game} is missing from the summary`,
      );
    }
  }
}

/**
 * Strip stale game-line copy, append frozen summary from ticket cards only, assert, return.
 */
export function composeFrozenGameLineLegNote(
  picks: ParsedPick[],
  contextNote: string,
  realOdds?: RealOddsEntry[],
): string {
  assertAllFrozenGameLineMetrics(picks, realOdds);
  let note = stripModelGameLineListings(contextNote);
  const summary = buildFrozenGameLineSummaryNote(picks, realOdds);
  if (summary) {
    note = note ? `${note}\n\n${summary}` : summary;
  }
  assertFrozenTicketConsistency(picks, note);
  return note;
}

/** Keep frozen game-line objects intact when props re-score in the background. */
export function mergeTicketPreservingFrozenGameLines(
  prior: ParsedPick[],
  next: ParsedPick[],
): ParsedPick[] {
  const frozenByGame = new Map<string, ParsedPick>();
  for (const p of prior) {
    if (!isGameLineFrozen(p)) continue;
    frozenByGame.set(normGameLabel(frozenGameLineHeader(p).game), p);
  }
  if (!frozenByGame.size) return next;

  const used = new Set<string>();
  const merged = next.map((p) => {
    if (!isGameLinePick(p) || p.isProp) return p;
    const key = normGameLabel(p.game);
    const frozen = frozenByGame.get(key);
    if (!frozen) return p;
    used.add(key);
    return frozen;
  });

  for (const [key, frozen] of frozenByGame) {
    if (!used.has(key)) merged.push(frozen);
  }
  return merged;
}

/** Surfaces that must show identical header fields for one frozen leg. */
export function frozenLegSurfaceLabels(pick: ParsedPick): {
  card: string;
  slip: string;
  breakdown: string;
  share: string;
} {
  const h = frozenGameLineHeader(pick);
  const label = `${h.pick} (${h.market}) · ${h.game}`;
  return { card: label, slip: label, breakdown: label, share: label };
}
