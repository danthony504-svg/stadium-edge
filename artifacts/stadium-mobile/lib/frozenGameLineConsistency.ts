// Single source of truth for frozen game-line display across summary, cards,
// breakdown, slip, and share. No line re-selection — read display snapshot only.

import type { ParsedPick } from "../components/PickCard.tsx";
import type { RealOddsEntry } from "./api.ts";
import { formatAmerican } from "./format.ts";
import { resolvePickEdgePct } from "./parlayQualifiedGate.ts";
import { gradeRank } from "./finalAiScore.ts";
import {
  assertGameLineFinalizeMetrics,
  assertGameLineProductionMetadataComplete,
  gameLineSimEdgeQualifies,
} from "./gameLineFrozenQual.ts";

const MIN_SUMMARY_GRADE = "C+";
const MIN_GAME_LINE_SUMMARY_CONFIDENCE = 50;

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

const normMarketLabel = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Spread / alt-spread line token from a pick label (e.g. "Yankees -1.5" → "-1.5"). */
export function spreadLineFromPickLabel(label: string): string | null {
  const m = String(label ?? "").trim().match(/([+-]\d+(?:\.\d+)?)\s*$/);
  return m ? m[1]! : null;
}

export type FrozenGameLineSurface = {
  gameId: string;
  game: string;
  market: string;
  pick: string;
  odds: number;
  line: string | null;
};

/** Single frozen game-line object every surface must read. */
export function frozenGameLineSurface(pick: ParsedPick): FrozenGameLineSurface {
  const header = frozenGameLineHeader(pick);
  return {
    gameId: normGameLabel(header.game),
    game: header.game,
    market: header.market,
    pick: header.pick,
    odds: header.odds,
    line: spreadLineFromPickLabel(header.pick),
  };
}

function surfacesMatch(a: FrozenGameLineSurface, b: FrozenGameLineSurface): boolean {
  return (
    a.gameId === b.gameId &&
    normPickLabel(a.pick) === normPickLabel(b.pick) &&
    normMarketLabel(a.market) === normMarketLabel(b.market) &&
    a.odds === b.odds &&
    (a.line ?? "") === (b.line ?? "")
  );
}

function logSurfaceMismatch(
  gameId: string,
  summary: FrozenGameLineSurface | GameLineMention,
  card: FrozenGameLineSurface,
): void {
  console.error(`[game-line surface mismatch] gameId=${gameId}`, {
    summary: {
      market: "market" in summary ? summary.market : undefined,
      pick: summary.pick,
      odds: "odds" in summary ? summary.odds : undefined,
      line: "line" in summary ? summary.line : spreadLineFromPickLabel(summary.pick),
    },
    card: {
      market: card.market,
      pick: card.pick,
      odds: card.odds,
      line: card.line,
    },
  });
}

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

const PLACEHOLDER = /^[—\-]+$/;
const PLACEHOLDER_GRADE = /^(?:[—\-]+|--|n\/a|null)$/i;

function isRealGrade(grade: string | null | undefined): grade is string {
  return (
    !!grade &&
    grade.trim() !== "" &&
    !PLACEHOLDER.test(grade.trim()) &&
    !PLACEHOLDER_GRADE.test(grade.trim()) &&
    gradeRank(grade) >= gradeRank(MIN_SUMMARY_GRADE)
  );
}

function isRealPositiveMetric(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n) && n > 0;
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
    !isRealPositiveMetric(edgePct) ||
    confidencePct == null ||
    !Number.isFinite(confidencePct) ||
    confidencePct < MIN_GAME_LINE_SUMMARY_CONFIDENCE ||
    !gameLineSimEdgeQualifies(simHit ?? 0, edgePct, {
      evPct: d?.evPct ?? pick.finalAiScore?.edgePct,
      isBestEvLine: pick.gameLineFinal?.isBestEv,
    })
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
    if (missing.length) {
      throw new FrozenGameLineConsistencyError(
        `Game line ${header.pick} (${header.game}) missing ${missing.join(", ")} — refusing incomplete metadata`,
      );
    }
    throw new FrozenGameLineConsistencyError(
      `Game line ${header.pick} (${header.game}) fails sim/edge qualification — refusing incomplete metadata`,
    );
  }
  assertGameLineFinalizeMetrics(pick, {
    grade: metrics.grade,
    confidencePct: metrics.confidencePct,
    simHit: (d?.simHit ?? pick.finalAiScore?.simHit)!,
    edgePct: metrics.edgePct,
    evPct: d?.evPct ?? pick.finalAiScore?.edgePct,
    market: header.market,
    odds: header.odds,
    isBestEvLine: pick.gameLineFinal?.isBestEv,
  });
  return metrics;
}

function assertSummaryHasNoPlaceholderDashes(summary: string): void {
  if (textHasPlaceholderGameLineMetrics(summary)) {
    throw new FrozenGameLineConsistencyError(
      "Game-line summary contains placeholder Final AI or Edge dashes — build refused",
    );
  }
  const LEGACY =
    /highest Final AI Score among|posted ML \/ spread|:\s*.+\s*\((?:Alt )?(?:Spread|Moneyline|ML|Total)\)\s*[—-]\s*Final AI|Final AI\s*(?:—|--)(?:\s|,|$)|Final AI:\s*(?:—|--)\b|edge\s*(?:—|--)(?:\s|,|$)|edge:\s*(?:—|--)\b|sim\s*(?:—|--)(?:\s|,|$)|conf(?:idence)?\s*(?:—|--)(?:\s|,|$)/i;
  if (LEGACY.test(summary)) {
    throw new FrozenGameLineConsistencyError(
      "Game-line summary contains placeholder dashes or legacy optimizer copy — build refused",
    );
  }
}

/** Hard fail before storing or rendering a frozen game-line summary. */
export function assertFrozenGameLineSummaryClean(summary: string): void {
  if (!summary.trim()) return;
  assertSummaryHasNoPlaceholderDashes(summary);
  for (const line of summary.split(/\n/)) {
    const t = line.trim();
    if (!t || !/@/.test(t)) continue;
    if (!/\*\*[^*]+\*\*/.test(t)) {
      throw new FrozenGameLineConsistencyError(
        "Game-line summary must use frozen pick format — legacy listing refused",
      );
    }
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
  const header = `**${row.pick}** (${row.market}) · ${formatAmerican(row.odds)} · ${row.game}`;
  const metricsLine = `Final AI: ${metrics.grade} · Confidence: ${metrics.confidencePct} · Edge: +${metrics.edgePct.toFixed(1)}% · Sim: ${metrics.simPct}%`;
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
  const gameLinePicks = picks.filter((p) => isGameLinePick(p) && !p.isProp);
  if (!gameLinePicks.length) return "";

  const rows = getFrozenGameLineLegs(picks);
  if (rows.length !== gameLinePicks.length) {
    throw new FrozenGameLineConsistencyError(
      "Every game-line leg on the ticket must have a complete frozen display before summary render",
    );
  }

  const pickByGame = new Map<string, ParsedPick>();
  for (const pick of gameLinePicks) {
    pickByGame.set(normGameLabel(frozenGameLineHeader(pick).game), pick);
  }

  const lines: string[] = [];
  for (const row of rows) {
    const pick = pickByGame.get(row.gameKey);
    if (!pick) {
      throw new FrozenGameLineConsistencyError(
        `Game line ${row.pick} (${row.game}) missing from frozen ticket`,
      );
    }
    lines.push(formatFrozenGameLineSummaryLine(row, pick, realOdds));
  }

  if (lines.length !== gameLinePicks.length) {
    throw new FrozenGameLineConsistencyError(
      "Game-line summary is missing one or more ticket legs — refusing partial summary",
    );
  }

  const intro = `_After the 10k sim, ${lines.length} qualified game line${lines.length === 1 ? "" : "s"} — every line shows Final AI, Confidence, Edge, and Sim from the frozen pick:_`;
  const summary = `${intro}\n\n${lines.map((n) => `• ${n}`).join("\n\n")}`;
  assertFrozenGameLineSummaryClean(summary);
  assertNoPlaceholderGameLineMetrics(summary);
  assertFrozenSummaryMetricsLinesComplete(summary);
  return summary;
}

/** True when text contains em-dash or ASCII placeholder metrics on a game-line listing. */
export function textHasPlaceholderGameLineMetrics(text: string): boolean {
  if (!text.trim()) return false;
  const PLACEHOLDER_METRIC =
    /Final AI\s*(?:[:—-]+\s*|:\s*)(?:—|--)(?:\s|,|;|$)|Final AI:\s*(?:—|--)\b|edge\s*(?:—|--)(?:\s|,|;|$)|edge:\s*(?:—|--)\b|Confidence:\s*(?:—|--)\b|Sim:\s*(?:—|--)\b|\)\s*--\s*Final AI/i;
  const GAME_LINE_CTX =
    /\((?:Alt )?(?:Spread|Moneyline|ML|Total)\)|\)\s*--\s*Final AI|\*\*[^*]+\*\*\s*\([^)]+\)\s*·|@[^@\n]+:/i;
  if (!GAME_LINE_CTX.test(text)) return false;
  return PLACEHOLDER_METRIC.test(text);
}

const FROZEN_SUMMARY_METRICS_LINE =
  /Final AI:\s*[^\s—-]+ · Confidence:\s*\d+ · Edge:\s*\+[\d.]+% · Sim:\s*\d+%/;

/** Every frozen summary bullet must include a complete metrics line — no placeholders. */
export function assertFrozenSummaryMetricsLinesComplete(summary: string): void {
  if (!summary.trim()) return;
  assertNoPlaceholderGameLineMetrics(summary);
  const blocks = summary.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  let gameLineBlocks = 0;
  for (const block of blocks) {
    if (!/\*\*[^*]+\*\*\s*\([^)]+\)\s*·/.test(block)) continue;
    gameLineBlocks += 1;
    if (!FROZEN_SUMMARY_METRICS_LINE.test(block)) {
      throw new FrozenGameLineConsistencyError(
        "Frozen game-line summary block missing complete Final AI, Confidence, Edge, or Sim metrics",
      );
    }
  }
  if (gameLineBlocks === 0 && /\*\*[^*]+\*\*/.test(summary)) {
    throw new FrozenGameLineConsistencyError(
      "Frozen game-line summary is missing complete metrics on every leg",
    );
  }
}

/** Hard fail on any game-line summary or optimizer copy with placeholder dashes. */
export function assertNoPlaceholderGameLineMetrics(text: string): void {
  if (!text.trim()) return;
  if (textHasPlaceholderGameLineMetrics(text)) {
    throw new FrozenGameLineConsistencyError(
      "Game-line copy contains placeholder Final AI or Edge dashes — render refused",
    );
  }
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
  odds?: number;
  line?: string | null;
};

/** Parse every game-line mention in legNote — frozen bullets and legacy optimizer lines. */
export function parseAllGameLineMentionsFromNote(note: string): Map<string, GameLineMention> {
  const out = new Map<string, GameLineMention>();
  if (!note.trim()) return out;

  for (const rawLine of note.split(/\n/)) {
    const trimmed = rawLine.trim().replace(/^[•*-]\s+/, "");
    if (!trimmed || !/@/.test(trimmed)) continue;

    const frozenWithOdds = trimmed.match(
      /\*\*([^*]+)\*\*\s*\(([^)]+)\)\s*·\s*([+-]?\d+)\s*·\s*(.+)$/,
    );
    if (frozenWithOdds) {
      const game = frozenWithOdds[4]!.trim();
      const gameKey = normGameLabel(game);
      const pick = frozenWithOdds[1]!.trim();
      out.set(gameKey, {
        gameKey,
        game,
        pick,
        market: frozenWithOdds[2]!.trim(),
        odds: Number(frozenWithOdds[3]),
        line: spreadLineFromPickLabel(pick),
      });
      continue;
    }

    const frozen = trimmed.match(/\*\*([^*]+)\*\*\s*\(([^)]+)\)\s*·\s*(.+)$/);
    if (frozen) {
      const game = frozen[3]!.trim();
      const gameKey = normGameLabel(game);
      const pick = frozen[1]!.trim();
      out.set(gameKey, {
        gameKey,
        game,
        pick,
        market: frozen[2]!.trim(),
        line: spreadLineFromPickLabel(pick),
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
  if (!t) return false;
  if (/highest Final AI Score among/i.test(t)) return true;
  if (/\*\*[^*]+\*\*\s*\([^)]+\)\s*·/.test(t)) return false;
  if (textHasPlaceholderGameLineMetrics(t)) return true;
  if (/\((?:Alt )?(?:Spread|Moneyline|ML|Total)\)\s*--/i.test(t)) return true;
  if (/\)\s*--\s*Final AI/i.test(t)) return true;
  if (/\((?:Alt )?(?:Spread|Moneyline|ML|Total)\)\s*[—-]\s*Final AI/i.test(t)) return true;
  if (/\((?:Alt )?(?:Spread|Moneyline|ML|Total)\)/i.test(t) && /:\s*.+\s*\(/.test(t)) return true;
  if (!/@/.test(t)) return false;
  if (/\((?:Alt )?(?:Spread|Moneyline|ML|Total)\)/i.test(t)) return true;
  if (/:\s*.+\s*\((?:Alt )?(?:Spread|Moneyline|ML|Total)\)/i.test(t)) return true;
  if (/Final AI\s*[:—-]/i.test(t)) return true;
  if (/edge\s*[:—-]/i.test(t)) return true;
  if (/sim\s*\d+%.*edge\s*[—\-]{1,2}/i.test(t)) return true;
  return false;
}

/** True when text contains legacy optimizer game-line copy that must never render. */
export function containsLegacyGameLineOptimizerCopy(text: string): boolean {
  if (!text.trim()) return false;
  if (textHasPlaceholderGameLineMetrics(text)) return true;
  if (/highest Final AI Score among/i.test(text)) return true;
  return text.split(/\n/).some((line) => {
    const t = line.trim();
    if (!t) return false;
    if (/\*\*[^*]+\*\*\s*\([^)]+\)\s*·/.test(t)) return false;
    return looksLikeGameLineListing(t);
  });
}

/** Remove model / legacy optimizer listings so only frozen summary remains. */
export function stripModelGameLineListings(note: string): string {
  if (!note.trim()) return "";
  const parts = note.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (looksLikeGameLineListing(p)) continue;
    if (/^After the 10k sim,/i.test(p)) continue;
    if (/highest Final AI Score among/i.test(p)) continue;
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
    const surface = frozenGameLineSurface(card);
    const summarySurface: FrozenGameLineSurface = {
      gameId: gameKey,
      game: mention.game,
      market: mention.market,
      pick: mention.pick,
      odds: mention.odds ?? surface.odds,
      line: mention.line ?? spreadLineFromPickLabel(mention.pick),
    };
    if (!surfacesMatch(summarySurface, surface)) {
      logSurfaceMismatch(gameKey, mention, surface);
      const parts: string[] = [];
      if (normPickLabel(mention.pick) !== normPickLabel(surface.pick)) {
        parts.push(`pick summary="${mention.pick}" card="${surface.pick}"`);
      }
      if (normMarketLabel(mention.market) !== normMarketLabel(surface.market)) {
        parts.push(`market summary="${mention.market}" card="${surface.market}"`);
      }
      if (mention.odds != null && mention.odds !== surface.odds) {
        parts.push(`odds summary=${mention.odds} card=${surface.odds}`);
      }
      const mentionLine = mention.line ?? spreadLineFromPickLabel(mention.pick);
      if ((mentionLine ?? "") !== (surface.line ?? "")) {
        parts.push(`line summary="${mentionLine ?? ""}" card="${surface.line ?? ""}"`);
      }
      throw new FrozenGameLineConsistencyError(
        `Summary vs card mismatch on gameId=${gameKey}: ${parts.join("; ")}`,
      );
    }
    const header = frozenGameLineHeader(card);
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

/** Force top-level pick fields to match the frozen display snapshot. */
export function canonicalizeFrozenGameLinePick(pick: ParsedPick): ParsedPick {
  if (!isGameLineFrozen(pick) || !pick.gameLineFinal?.display) return pick;
  const header = frozenGameLineHeader(pick);
  return {
    ...pick,
    game: header.game,
    market: header.market,
    pick: header.pick,
    odds: header.odds,
    gameLineFinal: {
      ...pick.gameLineFinal,
      display: pick.gameLineFinal.display,
    },
  };
}

/** Canonicalize every frozen game-line leg on a ticket before render or storage. */
export function canonicalizeFrozenTicket(picks: ParsedPick[]): ParsedPick[] {
  return picks.map((p) =>
    isGameLinePick(p) && !p.isProp ? canonicalizeFrozenGameLinePick(p) : p,
  );
}

/**
 * Hard fail before render when summary bullets disagree with frozen card surfaces
 * on market, pick, odds, or spread line. Logs gameId on mismatch.
 */
export function assertSummaryCardSurfaceAlignment(
  picks: ParsedPick[],
  gameLineSummary: string,
): void {
  if (!gameLineSummary.trim()) {
    throw new FrozenGameLineConsistencyError(
      "Game-line ticket missing optimizer summary — refusing render without frozen summary",
    );
  }
  assertFrozenGameLineSummaryClean(gameLineSummary);
  if (containsLegacyGameLineOptimizerCopy(gameLineSummary)) {
    throw new FrozenGameLineConsistencyError(
      "Legacy optimizer summary blocked — summary must match frozen gameLineFinal cards",
    );
  }
  assertNoPlaceholderGameLineMetrics(gameLineSummary);

  const cards = ticketGameLineCards(picks);
  const mentioned = parseAllGameLineMentionsFromNote(gameLineSummary);
  const rebuilt = buildFrozenGameLineSummaryNote(picks);
  if (rebuilt.trim() !== gameLineSummary.trim()) {
    for (const [gameKey, card] of cards) {
      const mention = mentioned.get(gameKey);
      const surface = frozenGameLineSurface(card);
      if (!mention) {
        console.error(`[game-line surface mismatch] gameId=${gameKey} missing from stored summary`);
        continue;
      }
      const summarySurface: FrozenGameLineSurface = {
        gameId: gameKey,
        game: mention.game,
        market: mention.market,
        pick: mention.pick,
        odds: mention.odds ?? surface.odds,
        line: mention.line ?? spreadLineFromPickLabel(mention.pick),
      };
      if (!surfacesMatch(summarySurface, surface)) {
        logSurfaceMismatch(gameKey, mention, surface);
      }
    }
    throw new FrozenGameLineConsistencyError(
      "Stored game-line summary does not match frozen cards — refusing stale optimizer copy",
    );
  }

  assertFrozenTicketConsistency(picks, gameLineSummary);
}

/**
 * Canonicalize, build summary from frozen snapshots, and hard-fail when any
 * game-line card would disagree with the optimizer summary on team/market/line.
 */
export function validateFrozenTicketForRender(
  picks: ParsedPick[],
  gameLineSummary?: string,
  realOdds?: RealOddsEntry[],
): ParsedPick[] {
  const canonical = canonicalizeFrozenTicket(picks);
  const hasGameLines = canonical.some((p) => isGameLinePick(p) && !p.isProp);
  if (!hasGameLines) return canonical;

  assertAllFrozenGameLineMetrics(canonical, realOdds);
  const summary = gameLineSummary ?? buildFrozenGameLineSummaryNote(canonical, realOdds);
  assertSummaryCardSurfaceAlignment(canonical, summary);
  return canonical;
}

/**
 * Production gate for AI Coach tickets — summary, cards, slip, and breakdown must
 * match; no duplicate games, opposing sides, or placeholder metric dashes.
 */
export function assertProductionCoachTicketIntegrity(
  picks: ParsedPick[],
  gameLineSummary?: string,
): ParsedPick[] {
  const canonical = canonicalizeFrozenTicket(picks);
  const gameLinePicks = canonical.filter((p) => isGameLinePick(p) && !p.isProp);
  if (!gameLinePicks.length) return canonical;

  ticketGameLineCards(canonical);

  for (const pick of gameLinePicks) {
    if (!isGameLineFrozen(pick)) {
      throw new FrozenGameLineConsistencyError(
        `Game line ${pick.pick} (${pick.game}) is not frozen — production render refused`,
      );
    }
    assertGameLineProductionMetadataComplete(pick);
    const surfaces = frozenLegSurfaceLabels(pick);
    const label = surfaces.card;
    if (surfaces.slip !== label || surfaces.breakdown !== label || surfaces.share !== label) {
      throw new FrozenGameLineConsistencyError(
        `Game line ${pick.pick} (${pick.game}) card/slip/breakdown/share disagree`,
      );
    }
  }

  const summary = gameLineSummary ?? buildFrozenGameLineSummaryNote(canonical);
  if (!summary.trim()) {
    throw new FrozenGameLineConsistencyError(
      "Production ticket has game-line legs but no frozen summary",
    );
  }
  assertProductionCoachTicketIntegritySummary(canonical, summary);
  return canonical;
}

/** Assert frozen summary matches cards with complete metadata and no placeholders. */
export function assertProductionCoachTicketIntegritySummary(
  picks: ParsedPick[],
  summary: string,
): void {
  assertFrozenSummaryMetricsLinesComplete(summary);
  assertSummaryCardSurfaceAlignment(picks, summary);
}
