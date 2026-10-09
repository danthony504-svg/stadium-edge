/**
 * Soft multi-sport mix for generic Coach board-scan tickets.
 * Does not change qualification thresholds — only swaps in already-qualified
 * legs when the staged ticket omitted them (or only has game lines).
 *
 * Priority sports are slate-aware for generic (no named sport) asks: NFL/NCAAF
 * stay first when they have upcoming events + odds, otherwise NHL/WNBA/tennis
 * and other eligible slate sports are considered without inventing quotas.
 */

import type { ParsedPick } from "../components/PickCard.tsx";
import { pickLegFingerprint } from "./parlayReachCore.ts";
import { boardLegPoolRole, type BoardScoredLeg } from "./ticketStaging.ts";

/** Football leagues that must not be starved on generic fixed-leg parlays. */
export const COACH_PRIORITY_SPORTS = ["nfl", "ncaaf"] as const;

/**
 * Soft priority order for slate-aware inject when football is absent tonight.
 * Does not force seats — inject only swaps already-qualified legs.
 */
export const COACH_SLATE_AWARE_SPORT_ORDER = [
  "nfl",
  "ncaaf",
  "nhl",
  "wnba",
  "nba",
  "mlb",
  "soccer",
  "ufc",
  "tennis",
  "ncaab",
] as const;

function sportId(pick: { sport?: string | null }): string {
  return String(pick.sport ?? "").toLowerCase();
}

/**
 * Sports present on the loaded board with at least one upcoming event that
 * carries provider odds (or a scored pool leg). Empty / unknown ids ignored.
 */
export function sportsPresentOnSlate(
  rows: Iterable<{ sport?: string | null }>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const s = sportId(row);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * Narrow ask-level priority sports to leagues that actually have slate events
 * with odds. When the ask did not name a sport (priority still defaults to
 * NFL/NCAAF) and football is empty tonight, expand to other eligible sports
 * that are on the slate so thin mixed boards are not football-starved into
 * tennis-only shortfalls.
 *
 * Never invents sports absent from `slateSports`. Never forces quotas —
 * callers still only inject already-qualified legs.
 */
export function slateAwarePrioritySports(
  askPrioritySports: readonly string[],
  slateSports: readonly string[],
): readonly string[] {
  const slate = new Set(
    slateSports.map((s) => String(s ?? "").toLowerCase()).filter(Boolean),
  );
  if (slate.size === 0) return askPrioritySports;

  const askPri = askPrioritySports
    .map((s) => String(s ?? "").toLowerCase())
    .filter(Boolean);
  const askOnSlate = askPri.filter((s) => slate.has(s));

  // Hard-named ask (e.g. college football → ["ncaaf"]): keep ask priority
  // intersected with the slate. Do not expand into unrelated leagues.
  const askIsDefaultFootball =
    askPri.length > 0 &&
    askPri.every((s) => (COACH_PRIORITY_SPORTS as readonly string[]).includes(s)) &&
    (COACH_PRIORITY_SPORTS as readonly string[]).every((s) => askPri.includes(s));

  if (!askIsDefaultFootball) {
    return askOnSlate.length > 0 ? askOnSlate : askPri.filter((s) => slate.has(s));
  }

  // Generic ask: football first when present, then other slate sports in a
  // stable order. Cap expansion so inject stays a soft mix, not a quota.
  const ordered: string[] = [];
  const push = (s: string) => {
    if (!slate.has(s) || ordered.includes(s)) return;
    ordered.push(s);
  };
  for (const s of COACH_PRIORITY_SPORTS) push(s);
  for (const s of COACH_SLATE_AWARE_SPORT_ORDER) push(s);
  for (const s of slate) push(s);

  // Prefer a short soft list: football seats + up to 3 other slate sports.
  const football = ordered.filter((s) =>
    (COACH_PRIORITY_SPORTS as readonly string[]).includes(s),
  );
  const others = ordered.filter(
    (s) => !(COACH_PRIORITY_SPORTS as readonly string[]).includes(s),
  );
  return [...football, ...others.slice(0, 3)];
}

/**
 * Round-robin game entries by sport so simulation coverage reaches NHL/WNBA/
 * tennis (etc.) on thin multi-sport slates instead of burning the budget on
 * one league's insertion order.
 */
export function interleaveEntriesBySport<T>(
  entries: readonly (readonly [string, T])[],
  sportOf: (gameLabel: string, value: T) => string,
): Array<[string, T]> {
  if (entries.length <= 1) return entries.map(([g, v]) => [g, v]);
  const buckets = new Map<string, Array<[string, T]>>();
  const sportOrder: string[] = [];
  for (const [game, value] of entries) {
    const sport = String(sportOf(game, value) || "unknown").toLowerCase();
    if (!buckets.has(sport)) {
      buckets.set(sport, []);
      sportOrder.push(sport);
    }
    buckets.get(sport)!.push([game, value]);
  }
  if (buckets.size <= 1) return entries.map(([g, v]) => [g, v]);

  // Prefer known sport order, then any remainder.
  const orderedSports = [
    ...COACH_SLATE_AWARE_SPORT_ORDER.filter((s) => buckets.has(s)),
    ...sportOrder.filter(
      (s) => !(COACH_SLATE_AWARE_SPORT_ORDER as readonly string[]).includes(s as never),
    ),
  ];
  const queues = orderedSports.map((s) => buckets.get(s) ?? []);
  const out: Array<[string, T]> = [];
  let remaining = entries.length;
  while (remaining > 0) {
    for (const q of queues) {
      if (!q.length) continue;
      out.push(q.shift()!);
      remaining -= 1;
    }
  }
  return out;
}

function pickComposite(pick: ParsedPick): number {
  return pick.finalAiScore?.composite ?? pick.scores?.composite ?? 0;
}

/**
 * Ensure NFL/NCAAF appear on generic tickets. Prefer already-qualified player
 * props over game lines so a Packers total alone does not "satisfy" football.
 */
export function injectPrioritySportsIntoTicket(
  picks: ParsedPick[],
  scored: BoardScoredLeg[],
  target: number,
  prioritySports: readonly string[] = COACH_PRIORITY_SPORTS,
): ParsedPick[] {
  if (target < 3 || picks.length === 0) return picks;
  let out = picks.slice(0, target);
  const used = new Set(out.map(pickLegFingerprint));

  for (const sport of prioritySports) {
    // Already have a player prop for this sport — done. Game-line-only NFL
    // must still attempt prop injection.
    if (out.some((p) => sportId(p) === sport && !!p.isProp)) continue;

    const candidates = scored
      .filter((leg) => {
        if (sportId(leg.pick) !== sport) return false;
        if (used.has(pickLegFingerprint(leg.pick))) return false;
        return boardLegPoolRole(leg.pick, leg.pick.finalAiScore) != null;
      })
      .sort((a, b) => {
        const propDelta = Number(!!b.pick.isProp) - Number(!!a.pick.isProp);
        if (propDelta !== 0) return propDelta;
        return b.rankScore - a.rankScore;
      });

    const best = candidates[0];
    if (!best) continue;

    const sportAlreadyOnTicket = out.some((p) => sportId(p) === sport);
    // Sport only as game line → only upgrade when we have a real prop.
    if (sportAlreadyOnTicket && !best.pick.isProp) continue;

    let worstIdx = -1;
    let worstScore = Number.POSITIVE_INFINITY;

    if (best.pick.isProp) {
      for (let i = 0; i < out.length; i++) {
        const p = out[i]!;
        if (sportId(p) !== sport || p.isProp) continue;
        const score = pickComposite(p);
        if (score < worstScore) {
          worstScore = score;
          worstIdx = i;
        }
      }
    }
    if (worstIdx < 0) {
      worstScore = Number.POSITIVE_INFINITY;
      for (let i = 0; i < out.length; i++) {
        const p = out[i]!;
        const sid = sportId(p);
        // Protect the sole seat for a priority sport; allow evicting duplicates
        // so a tennis-heavy ticket can still take NHL/WNBA on a thin slate.
        if (prioritySports.includes(sid as (typeof prioritySports)[number])) {
          const count = out.filter((x) => sportId(x) === sid).length;
          if (count <= 1) continue;
        }
        const score = pickComposite(p);
        if (score < worstScore) {
          worstScore = score;
          worstIdx = i;
        }
      }
    }
    if (worstIdx < 0) continue;

    const role = boardLegPoolRole(best.pick, best.pick.finalAiScore);
    if (!role) continue;

    used.delete(pickLegFingerprint(out[worstIdx]!));
    used.add(pickLegFingerprint(best.pick));
    out[worstIdx] = {
      ...best.pick,
      ticketRole: role,
      highRiskValuePlay: false,
    };
  }

  return out.slice(0, target);
}


/** Distinct sports present with at least one qualifying scored leg. */
export function qualifyingSportsInPool(
  scored: BoardScoredLeg[],
): string[] {
  const sports = new Set<string>();
  for (const leg of scored) {
    const s = sportId(leg.pick);
    if (!s) continue;
    if (boardLegPoolRole(leg.pick, leg.pick.finalAiScore) == null) continue;
    sports.add(s);
  }
  return [...sports];
}

/**
 * Non-majority seats to reserve on mix tickets (N≥6) when other sports qualify.
 * 9-leg → 3 seats; never invents sports that are not in the scored pool.
 */
export function reservedCrossSportSeats(
  target: number,
  otherSportsAvailable: number,
): number {
  if (target < 6 || otherSportsAvailable < 1) return 0;
  // Seat budget (9-leg → 3). Fill from any non-majority sports that qualify;
  // do not cap by sport-count so 2 NFL + 1 NCAAF can satisfy a 3-seat floor.
  return Math.ceil(target / 4);
}

function majoritySportOnTicket(picks: ParsedPick[]): string | null {
  const counts = new Map<string, number>();
  for (const p of picks) {
    const s = sportId(p);
    if (!s) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = -1;
  for (const [s, n] of counts) {
    if (n > bestN) {
      best = s;
      bestN = n;
    }
  }
  return best;
}

/**
 * After prop-slot fill, restore multi-sport mix on N≥6 generic tickets.
 * Swaps lowest-ranked majority-sport legs for already-qualified other-sport
 * legs (priority NFL/NCAAF first). Never invents legs or changes grade gates.
 */
export function enforceMultiSportFloorOnTicket(
  picks: ParsedPick[],
  scored: BoardScoredLeg[],
  target: number,
  prioritySports: readonly string[] = COACH_PRIORITY_SPORTS,
): ParsedPick[] {
  if (target < 6 || picks.length === 0) return picks;
  // Re-apply soft priority inject in case prop-slot fill evicted football seats.
  let out = injectPrioritySportsIntoTicket(picks, scored, target, prioritySports);
  out = out.slice(0, target);

  const poolSports = qualifyingSportsInPool(scored);
  if (poolSports.length < 2) return out;

  const majority = majoritySportOnTicket(out) ?? sportId(out[0]!);
  const otherSports = poolSports.filter((s) => s !== majority);
  const wantOther = reservedCrossSportSeats(target, otherSports.length);
  if (wantOther <= 0) return out;

  const used = new Set(out.map(pickLegFingerprint));

  const otherCount = () => out.filter((p) => sportId(p) !== majority).length;

  const nextCandidate = (): BoardScoredLeg | null => {
    const candidates = scored
      .filter((leg) => {
        const s = sportId(leg.pick);
        if (!s || s === majority) return false;
        if (used.has(pickLegFingerprint(leg.pick))) return false;
        return boardLegPoolRole(leg.pick, leg.pick.finalAiScore) != null;
      })
      .sort((a, b) => {
        const aPri = prioritySports.includes(sportId(a.pick) as (typeof prioritySports)[number]) ? 1 : 0;
        const bPri = prioritySports.includes(sportId(b.pick) as (typeof prioritySports)[number]) ? 1 : 0;
        if (aPri !== bPri) return bPri - aPri;
        const propDelta = Number(!!b.pick.isProp) - Number(!!a.pick.isProp);
        if (propDelta !== 0) return propDelta;
        // Prefer sports not yet on the ticket for true multi-sport mix.
        const aOn = out.some((p) => sportId(p) === sportId(a.pick)) ? 1 : 0;
        const bOn = out.some((p) => sportId(p) === sportId(b.pick)) ? 1 : 0;
        if (aOn !== bOn) return aOn - bOn;
        return b.rankScore - a.rankScore;
      });
    return candidates[0] ?? null;
  };

  while (otherCount() < wantOther) {
    const best = nextCandidate();
    if (!best) break;

    let worstIdx = -1;
    let worstScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < out.length; i++) {
      const p = out[i]!;
      if (sportId(p) !== majority) continue;
      // Prefer evicting majority props last so ~50% prop mix survives when possible.
      const score = pickComposite(p) + (p.isProp ? 3 : 0);
      if (score < worstScore) {
        worstScore = score;
        worstIdx = i;
      }
    }
    if (worstIdx < 0) break;

    const role = boardLegPoolRole(best.pick, best.pick.finalAiScore);
    if (!role) break;

    used.delete(pickLegFingerprint(out[worstIdx]!));
    used.add(pickLegFingerprint(best.pick));
    out[worstIdx] = {
      ...best.pick,
      ticketRole: role,
      highRiskValuePlay: false,
    };
  }

  return out.slice(0, target);
}
