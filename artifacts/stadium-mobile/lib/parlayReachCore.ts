// Pure helpers for explicit N-leg parlay reach (no React / PickCard imports).

import type { ParsedPick } from "../components/PickCard.tsx";
import {
  isAltPropPick,
  isMainBoardPick,
  isMainLineGameLeg,
  isQualifyingBackupGameLine,
} from "./altLinePool.ts";
import { buildFixedLegCountShortfallLead } from "./coachScanPolicy.ts";
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

/**
 * Fill a short ticket from qualifying mains + alts by validated nearScore.
 * No mains-first seating — a higher-scored alt can beat a lower-scored main.
 */
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

  const pool = mergeParlayRejects(qualifyingMains, qualifyingAlts);
  const gap = Math.max(0, target - merged.length);
  if (gap <= 0 || pool.length === 0) {
    return { picks: merged, promotedMains, promotedAlts };
  }

  let added = 0;
  for (const r of pool) {
    if (added >= gap) break;
    const fp = pickLegFingerprint(r.pick);
    if (onTicket.has(fp)) continue;
    const eligibleMain = isMainBoardPick(r.pick);
    const eligibleAlt =
      (r.pick.isProp && isAltPropPick(r.pick)) ||
      (!r.pick.isProp && isQualifyingBackupGameLine(r.pick));
    if (!eligibleMain && !eligibleAlt) continue;
    onTicket.add(fp);
    // Badge only — seating already ordered by nearScore across mains + alts.
    const ticketRole =
      r.pick.isProp
        ? isAltPropPick(r.pick)
          ? ("alt" as const)
          : ("main" as const)
        : isMainLineGameLeg(r.pick)
          ? ("main" as const)
          : ("alt" as const);
    const pick = {
      ...r.pick,
      ticketRole,
      backupReason: r.reason,
    } as ParsedPick & { backupReason?: string };
    merged.push(pick);
    if (ticketRole === "main") promotedMains.push(pick);
    else promotedAlts.push(pick);
    added += 1;
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
    `You asked for ${requested} legs. I searched moneylines, spreads, alt spreads, totals, alt totals, and player props across every game on ${oddsPhrase}, but only ${actual} cleared the quality filters — I won't pad with weak filler.`,
    `_Every other candidate failed sim cover, edge, or one-side-per-matchup rules. The ${backupCount} backup card${backupCount === 1 ? "" : "s"} below almost qualified._`,
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
      ? `You asked to exclude ${excludedSports.map((s) => s.toUpperCase()).join(", ")} — those leagues were off the board. `
      : "";
  const mainOn = staging?.mainOnTicket ?? 0;
  const altOn = staging?.altOnTicket ?? 0;
  const rolesMatchFinal = actual > 0 && mainOn + altOn === actual;
  // Full-ticket copy: cite discovered line count only — not intermediate
  // qualified pools (those can exceed the delivered ticket).
  const scanLeadFull = `${exclusion}I evaluated ${totalScanned} posted lines across every market on ${oddsPhrase} — ${FULL_BOARD_MARKET_FAMILIES}. Game sims and capped prop sims use shared 10k-draw Monte Carlo where supported, plus cross-book line shopping, correlation scoring, and historical learning from your graded results.`;
  void staging?.mainQualified;
  void staging?.altQualified;

  if (actual >= requested) {
    const fill = rolesMatchFinal
      ? altOn > 0
        ? ` ${mainOn} main pick${mainOn === 1 ? "" : "s"} and ${altOn} alt pick${altOn === 1 ? "" : "s"} (each alt labeled ALT PICK on the card).`
        : ` ${mainOn} main pick${mainOn === 1 ? "" : "s"}.`
      : "";
    return [
      scanLeadFull,
      `These ${actual} are the highest-rated by win probability, implied probability, EV, edge, confidence, and AI grade with low correlation across games.${fill}`,
    ].join("\n\n");
  }

  // Shortfall: final ticket length only — never cite intermediate pool sizes
  // next to a mismatched "Filled with" / "These N" trio.
  const lead =
    actual <= 0
      ? `You asked for ${requested} legs. No qualified picks were available, so no filler was added.`
      : `You asked for ${requested} legs. ${actual} qualified picks were available, so no filler was added.`;
  const roleDetail = rolesMatchFinal
    ? altOn > 0
      ? ` Ticket composition: ${mainOn} main pick${mainOn === 1 ? "" : "s"} and ${altOn} alt pick${altOn === 1 ? "" : "s"} (labeled ALT PICK).`
      : ` Ticket composition: ${mainOn} main pick${mainOn === 1 ? "" : "s"}.`
    : "";
  const scanLeadShort = `${exclusion}I evaluated ${totalScanned} posted lines across every market on ${oddsPhrase} — ${FULL_BOARD_MARKET_FAMILIES}. Game sims and capped prop sims use shared 10k-draw Monte Carlo where supported, plus cross-book line shopping, correlation scoring, and historical learning from your graded results.`;
  void totalQualified;
  return [lead + roleDetail, scanLeadShort].join("\n\n");
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
      ? `You asked to exclude ${excludedSports.map((s) => s.toUpperCase()).join(", ")} — those leagues are off the board. `
      : "";
  const altDetail =
    altCount > 0
      ? ` ${altCount} alternate line${altCount === 1 ? "" : "s"} on the ticket cleared sim grading with positive edge — each is labeled ALT PICK and graded separately.`
      : "";
  const shortfallLead = buildFixedLegCountShortfallLead(requested, actual);
  return [
    shortfallLead,
    `${exclusion}I evaluated posted spreads, totals, alt rungs, and props on ${oddsPhrase}, then seated the highest-ranked qualifying legs (mains and alternates compete on the same ranking).${altDetail} These ${actual} are every sim-aligned leg that cleared the quality bar.`,
  ].join("\n\n");
}
