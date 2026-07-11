// Pure helpers for explicit N-leg parlay reach (no React / PickCard imports).

import type { ParsedPick } from "../components/PickCard.tsx";
import { isQualifyingBackupGameLine } from "./altLinePool.ts";

export type ParlayLegReject = {
  pick: ParsedPick;
  reason: string;
  nearScore: number;
};

export function pickLegFingerprint(p: ParsedPick): string {
  return `${p.game}|${p.market}|${p.pick}|${p.odds}`.toLowerCase();
}

export function reachParlayMix(legTarget: number) {
  return {
    minProps: Math.max(4, Math.floor(legTarget * 0.35)),
    maxGameLegs: Math.max(5, Math.min(Math.ceil(legTarget * 0.5), legTarget - 3)),
  };
}

export function mergeParlayRejects(...groups: ParlayLegReject[][]): ParlayLegReject[] {
  const byFp = new Map<string, ParlayLegReject>();
  for (const g of groups) {
    for (const r of g) {
      const fp = pickLegFingerprint(r.pick);
      const cur = byFp.get(fp);
      if (!cur || r.nearScore > cur.nearScore) byFp.set(fp, r);
    }
  }
  return [...byFp.values()].sort((a, b) => b.nearScore - a.nearScore);
}

export function selectParlayBackupPicks(
  ticket: ParsedPick[],
  rejects: ParlayLegReject[],
  limit: number,
): ParsedPick[] {
  const onTicket = new Set(ticket.map(pickLegFingerprint));
  const out: ParsedPick[] = [];
  const seen = new Set<string>();
  for (const r of rejects) {
    const fp = pickLegFingerprint(r.pick);
    if (onTicket.has(fp) || seen.has(fp)) continue;
    if (!r.pick.isProp && !isQualifyingBackupGameLine(r.pick)) continue;
    seen.add(fp);
    out.push({ ...r.pick, backupReason: r.reason } as ParsedPick & { backupReason?: string });
    if (out.length >= limit) break;
  }
  return out;
}

/** Pull sim-graded alt rungs onto the main ticket when a reach-N ask is short. */
export function promoteQualifyingAltsToTicket(
  ticket: ParsedPick[],
  qualifying: ParlayLegReject[],
  target: number,
): { picks: ParsedPick[]; promoted: ParsedPick[] } {
  if (ticket.length >= target || qualifying.length === 0) {
    return { picks: ticket, promoted: [] };
  }
  const gap = target - ticket.length;
  const promoted = selectParlayBackupPicks(ticket, qualifying, gap);
  if (!promoted.length) return { picks: ticket, promoted: [] };
  const onTicket = new Set(ticket.map(pickLegFingerprint));
  const merged: ParsedPick[] = [...ticket];
  for (const p of promoted) {
    const fp = pickLegFingerprint(p);
    if (onTicket.has(fp)) continue;
    onTicket.add(fp);
    merged.push(p);
  }
  return { picks: merged, promoted };
}

export function buildParlayShortfallNote(
  requested: number,
  actual: number,
  _rejects: ParlayLegReject[],
  backupCount: number,
  oddsPhrase: string,
): string {
  return [
    `You asked for ${requested} legs. I searched moneylines, spreads, alt spreads, totals, alt totals, and player props across every game on ${oddsPhrase}, but only **${actual}** cleared the quality filters — I won't pad with weak filler.`,
    `_Every other candidate failed sim cover, edge, or one-side-per-matchup rules. The **${backupCount}** backup card${backupCount === 1 ? "" : "s"} below almost qualified._`,
  ].join("\n\n");
}

export function buildFullBoardShortfallNote(
  requested: number,
  actual: number,
  totalScanned: number,
  totalQualified: number,
  oddsPhrase: string,
  excludedSports?: string[],
): string {
  const exclusion =
    excludedSports && excludedSports.length > 0
      ? `You asked to exclude **${excludedSports.map((s) => s.toUpperCase()).join(", ")}** — those leagues were off the board. `
      : "";
  return [
    `${exclusion}You asked for ${requested} legs. I scanned **${totalScanned}** posted lines across every market on ${oddsPhrase} — moneylines, spreads, alternate spreads, totals, alternate totals, team totals, innings, halves, quarters, periods, player props, and alt props — and ran a 10k sim on each.`,
    totalQualified > actual
      ? `**${totalQualified}** cleared quality filters (positive EV/edge, grade ≥ C+, confidence ≥ 52%). These **${actual}** are the highest-rated by EV, edge, confidence, and AI grade.`
      : `Only **${totalQualified}** lines met quality standards after the full-board scan — here's every qualifying pick (no weak filler).`,
  ].join("\n\n");
}

export function buildQualifyingAltShortfallNote(
  requested: number,
  actual: number,
  altCount: number,
  oddsPhrase: string,
  excludedSports?: string[],
): string {
  const exclusion =
    excludedSports && excludedSports.length > 0
      ? `You asked to exclude **${excludedSports.map((s) => s.toUpperCase()).join(", ")}** — those leagues are off the board. `
      : "";
  return [
    `${exclusion}You asked for ${requested} legs. I simulated every posted spread, total, alt rung, and prop on ${oddsPhrase}, but only **${actual}** cleared the quality filters for your ticket — I won't pad with weak filler.`,
    altCount > 0
      ? `_The main line failed on some games, but **${altCount}** alternate line${altCount === 1 ? "" : "s"} below passed 10k sim grading with positive edge — each is graded separately._`
      : `_No alternate rungs cleared the quality bar on this slate — the honest ticket is the ${actual} leg${actual === 1 ? "" : "s"} above._`,
  ].join("\n\n");
}
