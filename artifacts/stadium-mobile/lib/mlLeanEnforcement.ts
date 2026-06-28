// Hard-lock game-side moneyline / spread legs to matchupHistory.mlLean.side when
// present. The Coach LLM can still flip sides for variety/value; this module is
// the belt-and-braces guarantee that rendered cards never show the opposing team
// when deterministic analytics have committed to a winner.

import type { ParsedPick } from "@/components/PickCard";
import {
  enrichPickMeta,
  gameAltOptions,
  gameSideFromPick,
  marketFamily,
  sameGame,
} from "@/components/PickCard";
import type { GameMeta, MatchupHistoryEntry, RealOddsEntry } from "@/lib/api";

const norm = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const teamNick = (team: string) => {
  const t = norm(team).split(" ").filter(Boolean);
  return t[t.length - 1] || "";
};

/** Token / nickname overlap — same helper spirit as matchupAlignment. */
export function teamsMatch(pickTeam: string, leanSide: string): boolean {
  const a = norm(pickTeam);
  const b = norm(leanSide);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const na = teamNick(pickTeam);
  const nb = teamNick(leanSide);
  if (na.length > 2 && na === nb) return true;
  const ta = new Set(a.split(" ").filter((w) => w.length > 2));
  return b
    .split(" ")
    .filter((w) => w.length > 2)
    .some((w) => ta.has(w));
}

function findHistoryEntry(
  game: string,
  history?: Record<string, MatchupHistoryEntry>,
): MatchupHistoryEntry | null {
  if (!history) return null;
  if (history[game]) return history[game]!;
  for (const [k, v] of Object.entries(history)) {
    if (sameGame(k, game)) return v;
  }
  return null;
}

/** Moneyline or spread/run-line — not props or game totals. */
export function isGameSideMlOrSpread(pick: ParsedPick): boolean {
  if (pick.isProp) return false;
  if (/\b(over|under)\b/i.test(pick.pick)) return false;
  const fam = marketFamily(pick.market);
  return fam.endsWith("moneyline") || fam.endsWith("spread");
}

function pickSideTeam(pick: ParsedPick): string | null {
  const side = gameSideFromPick(pick);
  return side?.name ?? null;
}

function legKey(p: ParsedPick): string {
  return `${p.game}|${p.market}|${p.pick}`.toLowerCase();
}

function buildFromRealOdds(
  ro: RealOddsEntry,
  pool: RealOddsEntry[],
  gameMeta: GameMeta[],
): ParsedPick {
  return enrichPickMeta(
    {
      game: ro.game,
      market: ro.market,
      pick: ro.pick,
      odds: ro.odds,
      sport: ro.sport,
      altOptions: gameAltOptions(ro, pool),
      startsAt: ro.startsAt ?? null,
    },
    gameMeta,
  );
}

function findReplacementOnLeanSide(
  pick: ParsedPick,
  leanSide: string,
  realOdds: RealOddsEntry[],
): RealOddsEntry | null {
  const fam = marketFamily(pick.market);
  const candidates = realOdds.filter(
    (r) => sameGame(r.game, pick.game) && marketFamily(r.market) === fam,
  );
  const onLean = candidates.filter((r) => {
    const t = pickSideTeam({
      game: r.game,
      market: r.market,
      pick: r.pick,
      odds: r.odds,
    });
    return t != null && teamsMatch(t, leanSide);
  });
  if (!onLean.length) return null;
  return onLean.find((r) => !/\balt\b/i.test(r.market)) ?? onLean[0]!;
}

export type MlLeanEnforcementResult = {
  picks: ParsedPick[];
  swapped: number;
  dropped: number;
};

/**
 * Swap or drop game-side ML/spread legs that oppose matchupHistory.mlLean. Props
 * and totals are untouched. When a wrong-side leg has a real posted line on the
 * lean team (same market family), swap to it; otherwise drop.
 */
export function enforceMlLeanOnPicks(
  picks: ParsedPick[],
  opts: {
    matchupHistory?: Record<string, MatchupHistoryEntry>;
    realOdds?: RealOddsEntry[];
    gameMeta?: GameMeta[];
  },
): MlLeanEnforcementResult {
  const realOdds = opts.realOdds ?? [];
  const gameMeta = opts.gameMeta ?? [];
  const seen = new Set<string>();
  let swapped = 0;
  let dropped = 0;
  const out: ParsedPick[] = [];

  for (const pick of picks) {
    if (!isGameSideMlOrSpread(pick)) {
      const k = legKey(pick);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(pick);
      }
      continue;
    }

    const entry = findHistoryEntry(pick.game, opts.matchupHistory);
    const leanSide = entry?.mlLean?.side;
    if (!leanSide) {
      const k = legKey(pick);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(pick);
      }
      continue;
    }

    const team = pickSideTeam(pick);
    if (!team || teamsMatch(team, leanSide)) {
      const k = legKey(pick);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(pick);
      }
      continue;
    }

    const replacement = findReplacementOnLeanSide(pick, leanSide, realOdds);
    if (!replacement) {
      dropped += 1;
      continue;
    }

    const rep = buildFromRealOdds(replacement, realOdds, gameMeta);
    const k = legKey(rep);
    if (seen.has(k)) {
      dropped += 1;
      continue;
    }
    seen.add(k);
    swapped += 1;
    out.push(rep);
  }

  return { picks: out, swapped, dropped };
}

export function mlLeanEnforcementNote(result: MlLeanEnforcementResult): string {
  if (result.swapped === 0 && result.dropped === 0) return "";
  const parts: string[] = [];
  if (result.swapped > 0) {
    parts.push(
      `_Aligned ${result.swapped} leg${result.swapped === 1 ? "" : "s"} to tonight's analytics lean (same team the form data favors)._`,
    );
  }
  if (result.dropped > 0) {
    parts.push(
      `_Dropped ${result.dropped} leg${result.dropped === 1 ? "" : "s"} that opposed the analytics lean and had no matching real line on the favored side._`,
    );
  }
  return parts.join("\n\n");
}
