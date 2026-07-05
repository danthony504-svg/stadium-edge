// Post-simulation ticket optimizer — filter weak props, swap better alt lines,
// suggest replacements, and reorder strongest → weakest. User selections never
// bypass the quality bar.

import type { PropPoolEntry, PropSimulationResult } from "./api";
import type { CombinedPickScore } from "./pickScore";
import {
  gradeRank,
  isRecommendableProp,
  resolveDisplayEdge,
  simulatorSimConfidence,
} from "./simulatorRecommendations";
import { isDeepMonteCarloComplete, isValidPropSimData } from "./simPropValidity";
import { propRankScore } from "./simulatorPresentation";
import {
  gradeSimulatorProps,
  poolEntryToSelected,
  simulatorPropKey,
  type SimulatorPlayerHistorySlice,
  type SimulatorSelectedProp,
} from "./simulatorPickPool";
import type { InjuryTeam, MatchupHistoryEntry } from "./api";
import type { GameInjuryReport } from "./injuries";
import { propMarketLabel } from "./propMarketLabel";

export const SIM_TICKET_MIN_GRADE = "B+";
export const SIM_TICKET_MIN_CONFIDENCE = 55;
export const SIM_TICKET_MIN_SUBSCORE = 5.5;
export const SIM_TICKET_INJURY_FLOOR = 5.0;

export type SimTicketChange =
  | { kind: "removed"; label: string; reason: string }
  | { kind: "alt_line"; label: string; fromLine: number; toLine: number; reason: string }
  | { kind: "added"; label: string; reason: string }
  | { kind: "reordered"; label: string };

export type OptimizeSimulatorTicketResult = {
  props: SimulatorSelectedProp[];
  results: PropSimulationResult[];
  changes: SimTicketChange[];
  explanation: string[];
};

export type SimulatorGradingCtx = {
  gameLabel: string;
  sport: string;
  propPool: PropPoolEntry[];
  fullPool: PropPoolEntry[];
  matchupHistory?: Record<string, MatchupHistoryEntry>;
  matchupInjuries?: Record<string, GameInjuryReport>;
  playerHistory?: Record<string, SimulatorPlayerHistorySlice>;
  injuryTeams?: InjuryTeam[];
};

function shortName(player: string): string {
  return player.split(" ").slice(-1)[0] ?? player;
}

function propLabel(s: SimulatorSelectedProp): string {
  return `${shortName(s.player)} ${s.label}`;
}

/** Strict ticket quality — every grounded signal must support the pick. */
export function evaluateSimulatorTicketQuality(
  combined: CombinedPickScore | null | undefined,
  simRow: PropSimulationResult | null | undefined,
): { passes: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!combined?.grade) reasons.push("no grade");
  else if (gradeRank(combined.grade) < gradeRank(SIM_TICKET_MIN_GRADE)) {
    reasons.push(`grade ${combined.grade} below ${SIM_TICKET_MIN_GRADE}`);
  }

  const conf = combined?.confidencePct;
  if (conf == null || conf < SIM_TICKET_MIN_CONFIDENCE) {
    reasons.push("confidence below bar");
  }

  if (!simRow || !isValidPropSimData(simRow)) reasons.push("sim data incomplete");
  else if (!isDeepMonteCarloComplete(simRow)) reasons.push("needs full 10,000 sim run");

  if (!isRecommendableProp(combined, simRow)) reasons.push("edge or sim hit too weak");

  const edge = resolveDisplayEdge(combined, simRow);
  if (edge == null || edge <= 0) reasons.push("no positive edge");

  const sub = combined?.scores;
  if (sub?.matchup != null && sub.matchup < SIM_TICKET_MIN_SUBSCORE) reasons.push("weak matchup");
  if (sub?.trend != null && sub.trend < SIM_TICKET_MIN_SUBSCORE) reasons.push("cold recent form");
  if (sub?.injury != null && sub.injury < SIM_TICKET_INJURY_FLOOR) reasons.push("injury concern");
  if (sub?.lineShopping != null && sub.lineShopping < SIM_TICKET_MIN_SUBSCORE) {
    reasons.push("weak line value vs other books");
  }

  return { passes: reasons.length === 0, reasons };
}

function gradeOne(
  prop: SimulatorSelectedProp,
  simRows: Map<string, PropSimulationResult>,
  ctx: SimulatorGradingCtx,
): { combined: CombinedPickScore | null; simRow: PropSimulationResult | null } {
  const key = simulatorPropKey(prop);
  const simRow = simRows.get(key) ?? null;
  const simMap = new Map<string, { hitProbability: number | null }>();
  if (simRow) simMap.set(key, { hitProbability: simRow.hitProbability });
  const scores = gradeSimulatorProps([prop], ctx.gameLabel, ctx.sport, ctx.fullPool, {
    matchupHistory: ctx.matchupHistory,
    matchupInjuries: ctx.matchupInjuries,
    playerHistory: ctx.playerHistory,
    propSimulations: simMap,
    propSimRows: simRow ? new Map([[key, simRow]]) : new Map(),
    injuryTeams: ctx.injuryTeams,
  });
  return { combined: scores.get(key) ?? null, simRow };
}

/** Alt + replacement rungs to Monte Carlo before optimization. */
export function collectExtraSimCandidates(
  selected: SimulatorSelectedProp[],
  fullPool: PropPoolEntry[],
  existingKeys: Set<string>,
  opts?: { maxAltsPerProp?: number; maxReplacements?: number },
): SimulatorSelectedProp[] {
  const maxAlts = opts?.maxAltsPerProp ?? 3;
  const maxRepl = opts?.maxReplacements ?? 4;
  const out: SimulatorSelectedProp[] = [];
  const seen = new Set(existingKeys);

  for (const s of selected) {
    const market = s.market;
    const alts = fullPool
      .filter(
        (e) =>
          e.player === s.player &&
          (e.marketKey ?? e.marketLabel) === market &&
          e.side === s.side &&
          e.line != null &&
          Math.abs((e.line as number) - s.line) > 0.01,
      )
      .sort(
        (a, b) =>
          Math.abs((a.line as number) - s.line) - Math.abs((b.line as number) - s.line),
      )
      .slice(0, maxAlts);
    for (const e of alts) {
      const cand = poolEntryToSelected(e);
      const key = simulatorPropKey(cand);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cand);
    }
  }

  const usedPlayers = new Set(selected.map((s) => s.player.toLowerCase()));
  let replAdded = 0;
  const repl = [...fullPool]
    .filter(
      (e) =>
        e.line != null &&
        (e.edge ?? 0) > 0 &&
        !usedPlayers.has(e.player.toLowerCase()),
    )
    .sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0));
  for (const e of repl) {
    if (replAdded >= maxRepl) break;
    const cand = poolEntryToSelected(e);
    const key = simulatorPropKey(cand);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cand);
    replAdded += 1;
  }

  return out;
}

type ScoredSlot = {
  prop: SimulatorSelectedProp;
  combined: CombinedPickScore;
  simRow: PropSimulationResult;
  rankScore: number;
};

function bestRungForSlot(
  player: string,
  market: string,
  side: "Over" | "Under",
  originalLine: number,
  simRows: Map<string, PropSimulationResult>,
  fullPool: PropPoolEntry[],
  ctx: SimulatorGradingCtx,
): { best: ScoredSlot | null; altChange: SimTicketChange | null } {
  const rungs = fullPool.filter(
    (e) =>
      e.player === player &&
      (e.marketKey ?? e.marketLabel) === market &&
      e.side === side &&
      e.line != null,
  );
  let best: ScoredSlot | null = null;
  let altChange: SimTicketChange | null = null;

  for (const e of rungs) {
    const prop = poolEntryToSelected(e);
    const key = simulatorPropKey(prop);
    const simRow = simRows.get(key);
    if (!simRow) continue;
    const { combined } = gradeOne(prop, simRows, ctx);
    if (!combined) continue;
    const quality = evaluateSimulatorTicketQuality(combined, simRow);
    if (!quality.passes) continue;
    const rankScore = propRankScore(combined, simRow);
    if (!best || rankScore > best.rankScore) {
      best = { prop, combined, simRow, rankScore };
    }
  }

  if (
    best &&
    Math.abs(best.prop.line - originalLine) > 0.01
  ) {
    const hit = Math.round((best.simRow.hitProbability ?? 0) * 100);
    const edge = resolveDisplayEdge(best.combined, best.simRow);
    altChange = {
      kind: "alt_line",
      label: propLabel(best.prop),
      fromLine: originalLine,
      toLine: best.prop.line,
      reason: `better balance — ${hit}% sim hit, ${edge != null ? `${edge > 0 ? "+" : ""}${edge}%` : "—"} edge, grade ${best.combined.grade}`,
    };
  }

  return { best, altChange };
}

/** Apply quality filter, alt-line picks, replacements, and reorder. */
export function optimizeSimulatorTicket(
  selected: SimulatorSelectedProp[],
  allResults: PropSimulationResult[],
  ctx: SimulatorGradingCtx,
): OptimizeSimulatorTicketResult {
  const simRows = new Map(allResults.map((r) => [r.key, r]));
  const changes: SimTicketChange[] = [];
  const explanation: string[] = [];
  const originalCount = selected.length;

  const slots: ScoredSlot[] = [];
  const processedPlayers = new Set<string>();

  for (const s of selected) {
    const slotKey = `${s.player}|${s.market}|${s.side}`;
    if (processedPlayers.has(slotKey)) continue;
    processedPlayers.add(slotKey);

    const { best, altChange } = bestRungForSlot(
      s.player,
      s.market,
      s.side,
      s.line,
      simRows,
      ctx.fullPool,
      ctx,
    );

    if (!best) {
      const { combined, simRow } = gradeOne(s, simRows, ctx);
      const quality = evaluateSimulatorTicketQuality(combined, simRow);
      const reason = quality.reasons[0] ?? "didn't clear the quality bar";
      changes.push({ kind: "removed", label: propLabel(s), reason });
      explanation.push(`Removed ${propLabel(s)} — ${reason}.`);
      continue;
    }

    if (altChange) {
      changes.push(altChange);
      explanation.push(
        `Swapped ${shortName(s.player)} to ${best.prop.side} ${best.prop.line} ${propMarketLabel(best.prop.market)} (${altChange.reason}).`,
      );
    }
    slots.push(best);
  }

  const keptPlayers = new Set(slots.map((x) => x.prop.player.toLowerCase()));
  const dropped = originalCount - slots.length;

  if (dropped > 0) {
    const replCandidates = [...ctx.fullPool]
      .filter(
        (e) =>
          e.line != null &&
          (e.edge ?? 0) > 0 &&
          !keptPlayers.has(e.player.toLowerCase()),
      )
      .sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0));

    let added = 0;
    for (const e of replCandidates) {
      if (added >= dropped) break;
      const prop = poolEntryToSelected(e);
      if (keptPlayers.has(prop.player.toLowerCase())) continue;
      const key = simulatorPropKey(prop);
      const simRow = simRows.get(key);
      if (!simRow) continue;
      const { combined } = gradeOne(prop, simRows, ctx);
      const quality = evaluateSimulatorTicketQuality(combined, simRow);
      if (!quality.passes || !combined) continue;

      const rankScore = propRankScore(combined, simRow);
      slots.push({ prop, combined, simRow, rankScore });
      keptPlayers.add(prop.player.toLowerCase());
      added += 1;
      const hit = Math.round((simRow.hitProbability ?? 0) * 100);
      const simConf = simulatorSimConfidence(simRow);
      changes.push({
        kind: "added",
        label: propLabel(prop),
        reason: `grade ${combined.grade}, ${hit}% sim hit`,
      });
      explanation.push(
        `Added ${propLabel(prop)} as a stronger replacement (grade ${combined.grade}, ${hit}% sim hit${simConf != null ? `, ${simConf}% sim confidence` : ""}).`,
      );
    }
  }

  slots.sort((a, b) => b.rankScore - a.rankScore);

  if (slots.length < originalCount && explanation.length === 0) {
    explanation.push(
      `Only ${slots.length} of ${originalCount} selected props cleared the B+ / edge / 10,000-sim bar — showing the honest ticket.`,
    );
  } else if (slots.length > 0 && changes.some((c) => c.kind === "removed" || c.kind === "added" || c.kind === "alt_line")) {
    explanation.unshift(
      `Optimized your ${originalCount}-prop ticket to ${slots.length} leg${slots.length === 1 ? "" : "s"} — strongest picks first.`,
    );
  }

  const props = slots.map((s) => s.prop);
  const keys = new Set(props.map((p) => simulatorPropKey(p)));
  const results = allResults.filter((r) => keys.has(r.key));

  return { props, results, changes, explanation };
}
