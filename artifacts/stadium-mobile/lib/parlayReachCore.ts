// Pure helpers for explicit N-leg parlay reach (no React / PickCard imports).

import type { ParsedPick } from "./parsedPick.ts";
import {
  isAltPropPick,
  isMainBoardPick,
  isMainLineGameLeg,
  isQualifyingBackupGameLine,
} from "./altLinePool.ts";
import { COACH_FIXED_LEG_SHORTFALL_LEAD, buildFixedLegCountShortfallLead } from "./coachScanPolicy.ts";
import { FULL_BOARD_MARKET_FAMILIES } from "./fullBoardMarketCopy.ts";

export type ParlayLegReject = {
  pick: ParsedPick;
  reason: string;
  nearScore: number;
};

export function pickLegFingerprint(p: ParsedPick): string {
  return `${p.game}|${p.market}|${p.pick}|${p.odds}`.toLowerCase();
}

export function reachParlayMix(legTarget: number) {
  const minProps = Math.max(1, Math.round(legTarget * 0.5));
  const maxGameLegs = Math.max(0, Math.ceil(legTarget * 0.3));
  return { minProps, maxGameLegs };
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

export function selectParlayMainBackupPicks(
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
    if (!isMainBoardPick(r.pick)) continue;
    if (r.pick.isProp) {
      if (isAltPropPick(r.pick)) continue;
    } else if (!isMainLineGameLeg(r.pick)) {
      continue;
    }
    seen.add(fp);
    out.push({
      ...r.pick,
      ticketRole: "main" as const,
      backupReason: r.reason,
    } as ParsedPick & { backupReason?: string });
    if (out.length >= limit) break;
  }
  return out;
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
    if (r.pick.isProp) {
      if (!isAltPropPick(r.pick)) continue;
    } else if (!isQualifyingBackupGameLine(r.pick)) {
      continue;
    }
    seen.add(fp);
    out.push({
      ...r.pick,
      ticketRole: "alt" as const,
      backupReason: r.reason,
    } as ParsedPick & { backupReason?: string });
    if (out.length >= limit) break;
  }
  return out;
}

/** Step 2: highest-rated mains first. Step 3: qualifying alts to reach target. */
export function promoteQualifyingStagedToTicket(
  ticket: ParsedPick[],
  qualifyingMains: ParlayLegReject[],
  qualifyingAlts: ParlayLegReject[],
  target: number,
): { picks: ParsedPick[]; promotedMains: ParsedPick[]; promotedAlts: ParsedPick[] } {
  let merged = [...ticket];
  const promotedMains: ParsedPick[] = [];
  const promotedAlts: ParsedPick[] = [];
  const onTicket = new Set(merged.map(pickLegFingerprint));

  // Step 2: add qualifying mains first (highest-rated not already on ticket).
  const mainGap = Math.max(0, target - merged.length);
  if (mainGap > 0 && qualifyingMains.length > 0) {
    for (const p of selectParlayMainBackupPicks(merged, qualifyingMains, mainGap)) {
      const fp = pickLegFingerprint(p);
      if (onTicket.has(fp)) continue;
      onTicket.add(fp);
      merged.push(p);
      promotedMains.push(p);
    }
  }

  // Step 3: promote qualifying alternates until target or pool exhausted.
  const altGap = Math.max(0, target - merged.length);
  if (altGap > 0 && qualifyingAlts.length > 0) {
    for (const p of selectParlayBackupPicks(merged, qualifyingAlts, altGap)) {
      const fp = pickLegFingerprint(p);
      if (onTicket.has(fp)) continue;
      onTicket.add(fp);
      merged.push(p);
      promotedAlts.push(p);
    }
  }

  return { picks: merged, promotedMains, promotedAlts };
}

/** Coach entry point — same module as promoteQualifyingStagedToTicket (no cross-file binding). */
export function fillReachTicketStaged(
  ticket: ParsedPick[],
  target: number,
  qualifyingMains: ParlayLegReject[],
  qualifyingAlts: ParlayLegReject[],
): { picks: ParsedPick[]; promotedMains: ParsedPick[]; promotedAlts: ParsedPick[] } {
  return promoteQualifyingStagedToTicket(ticket, qualifyingMains, qualifyingAlts, target);
}

/** Coach entry point — same module as promoteQualifyingAltsToTicket. */
export function fillReachTicketWithQualifyingAlts(
  ticket: ParsedPick[],
  target: number,
  qualifying: ParlayLegReject[],
): { picks: ParsedPick[]; promoted: ParsedPick[] } {
  return promoteQualifyingAltsToTicket(ticket, qualifying, target);
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
  const added: ParsedPick[] = [];
  for (const p of promoted) {
    const fp = pickLegFingerprint(p);
    if (onTicket.has(fp)) continue;
    onTicket.add(fp);
    merged.push(p);
    added.push(p);
  }
  return { picks: merged, promoted: added };
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
  staging?: {
    mainQualified: number;
    altQualified: number;
    mainOnTicket: number;
    altOnTicket: number;
  },
): string {
  const exclusion =
    excludedSports && excludedSports.length > 0
      ? `You asked to exclude **${excludedSports.map((s) => s.toUpperCase()).join(", ")}** — those leagues were off the board. `
      : "";
  const mainQ = staging?.mainQualified ?? totalQualified;
  const altQ = staging?.altQualified ?? 0;
  const mainOn = staging?.mainOnTicket ?? actual;
  const altOn = staging?.altOnTicket ?? 0;
  const altFill =
    altOn > 0
      ? ` **${mainOn}** main pick${mainOn === 1 ? "" : "s"} and **${altOn}** alt pick${altOn === 1 ? "" : "s"} (each alt labeled **ALT PICK** on the card).`
      : mainOn > 0
        ? ` **${mainOn}** main pick${mainOn === 1 ? "" : "s"}.`
        : "";
  const scanLead = `${exclusion}I scanned **${totalScanned}** posted lines across every market on ${oddsPhrase} — ${FULL_BOARD_MARKET_FAMILIES} — with a 10k sim on each, cross-book line shopping, correlation scoring, and historical learning from your graded results.`;
  const shortfallLead = buildFixedLegCountShortfallLead(requested, actual);
  if (actual >= requested) {
    return [
      scanLead,
      `**${mainQ}** main lines and **${altQ}** alt lines cleared quality filters.${altFill} These **${actual}** are the highest-rated by win probability, implied probability, EV, edge, confidence, and AI grade with low correlation across games.`,
    ].join("\n\n");
  }
  if (altOn > 0 || altQ > 0) {
    return [
      shortfallLead,
      scanLead,
      `**${mainQ}** main lines and **${altQ}** alt lines cleared quality filters — I filled with every qualifying main, then promoted alternate rungs where mains ran out.${altFill} These **${actual}** are every sim-aligned leg on today's board.`,
    ].join("\n\n");
  }
  return [
    shortfallLead,
    scanLead,
    `${COACH_FIXED_LEG_SHORTFALL_LEAD} **${mainQ}** main and **${altQ}** alt lines met quality standards after the full-board scan.${altFill} These **${actual}** are every AI-backed pick on the board.`,
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
  const altDetail =
    altCount > 0
      ? ` **${altCount}** alternate line${altCount === 1 ? "" : "s"} on the ticket passed 10k sim grading with positive edge — each is labeled **ALT PICK** and graded separately.`
      : "";
  const shortfallLead = buildFixedLegCountShortfallLead(requested, actual);
  return [
    shortfallLead,
    `${exclusion}I simulated every posted spread, total, alt rung, and prop on ${oddsPhrase}, then filled with mains first and alternate rungs where needed.${altDetail} These **${actual}** are every sim-aligned leg that cleared the quality bar.`,
  ].join("\n\n");
}
