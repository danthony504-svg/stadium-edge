// Pure helpers for explicit N-leg parlay reach (no React / PickCard imports).

import type { ParsedPick } from "../components/PickCard.tsx";

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
    seen.add(fp);
    out.push({ ...r.pick, backupReason: r.reason } as ParsedPick & { backupReason?: string });
    if (out.length >= limit) break;
  }
  return out;
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

export function buildQualifyingAltShortfallNote(
  requested: number,
  actual: number,
  altCount: number,
  oddsPhrase: string,
): string {
  return [
    `You asked for ${requested} legs. I simulated every posted spread, total, alt rung, and prop on ${oddsPhrase}, but only **${actual}** cleared the quality filters for your ticket — I won't pad with weak filler.`,
    altCount > 0
      ? `_The main line failed on some games, but **${altCount}** alternate line${altCount === 1 ? "" : "s"} below passed 10k sim grading with positive edge — each is graded separately._`
      : `_No alternate rungs cleared the quality bar on this slate — the honest ticket is the ${actual} leg${actual === 1 ? "" : "s"} above._`,
  ].join("\n\n");
}
