/**
 * Immutable Coach ask sport scope — explicit league intent for pool, sim, seat,
 * recovery, and final tickets.
 *
 * Must NOT use askAllowsNcaafPlayerProps: that flag is college team-markets vs
 * player-props opt-in and is true for generic "player props" wording (including
 * explicit NFL asks). Sport scope is resolved from named leagues / board sports.
 */

import {
  normalizeFootballRecoverySport,
  filterPoolByFootballRecoverySports,
  type FootballSkillRecoveryScope,
} from "./coachFootballPropsOnlyRecovery.ts";

export { normalizeFootballRecoverySport };

export type CoachAskSportScope = FootballSkillRecoveryScope;

/** Explicit football singleton from ask text — null when both/neither. */
export type ExplicitFootballSport = "nfl" | "ncaaf" | null;

function askHasCollegeFootballTokens(t: string): boolean {
  if (/\bncaaf\b|\bcfb\b|\bcollege\s+football\b|\bcollage\s+football\b/.test(t)) {
    return true;
  }
  return (
    /\b(?:college|collage)\b/.test(t) &&
    !/\b(?:college|collage)\s+basketball\b/.test(t) &&
    !/\bncaab\b|\bcbb\b/.test(t)
  );
}

/**
 * Deterministic football intent:
 * - explicit NFL (no college/NCAAF tokens) → "nfl"
 * - college-only / NCAAF / CFB → "ncaaf"
 * - generic "football" or mixed → null (both leagues may remain if board says so)
 */
export function explicitFootballPropsSportScope(
  text?: string | null,
): ExplicitFootballSport {
  const t = String(text ?? "").toLowerCase();
  if (!t) return null;
  const hasCollege = askHasCollegeFootballTokens(t);
  const hasNfl = /\bnfl\b/.test(t);
  // Explicit NFL wins over bare "football"; college tokens without NFL → NCAAF.
  if (hasNfl && !hasCollege) return "nfl";
  if (hasCollege && !hasNfl) return "ncaaf";
  // "nfl and college" / ambiguous mix → null (board sports decide).
  return null;
}

/**
 * Immutable allowed sports for the whole Coach pipeline.
 * Board sports from load are the base; explicit NFL/NCAAF force a singleton
 * so a widened/mixed pool cannot admit the other league.
 */
export function resolveImmutableAskSportScope(opts: {
  askText?: string | null;
  boardSports: readonly string[];
}): string[] {
  const explicit = explicitFootballPropsSportScope(opts.askText);
  if (explicit === "nfl") return ["nfl"];
  if (explicit === "ncaaf") return ["ncaaf"];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of opts.boardSports ?? []) {
    const n = normalizeFootballRecoverySport(raw);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** Alias — sport belt used at load, sim, seat, recovery, partial, final. */
export const filterPoolByAllowedSports = filterPoolByFootballRecoverySports;

export function rowMatchesAllowedSports(
  sport: string | null | undefined,
  scope: CoachAskSportScope,
): boolean {
  const allowed = new Set(
    (scope.allowedSports ?? [])
      .map((s) => normalizeFootballRecoverySport(s))
      .filter(Boolean),
  );
  if (allowed.size === 0) return false;
  const n = normalizeFootballRecoverySport(sport);
  if (!n) return false;
  return allowed.has(n);
}

/**
 * Resolve a candidate sport from the row tag, else authoritative event metadata
 * (espn game sport for matching game label). Never invents "nfl".
 */
export function resolveAuthoritativeCandidateSport(opts: {
  sport?: string | null;
  game?: string | null;
  espnGames?: readonly { sport?: string | null; name?: string | null; shortName?: string | null; homeTeam?: string | null; awayTeam?: string | null }[];
}): string | null {
  const tagged = normalizeFootballRecoverySport(opts.sport);
  if (tagged) return tagged;
  const game = String(opts.game ?? "").toLowerCase().trim();
  if (!game || !opts.espnGames?.length) return null;
  for (const g of opts.espnGames) {
    const label = `${g.awayTeam ?? ""} @ ${g.homeTeam ?? ""}`.toLowerCase();
    const name = String(g.name ?? g.shortName ?? "").toLowerCase();
    if (
      (label && (game === label || game.includes(label) || label.includes(game))) ||
      (name && (game === name || game.includes(name)))
    ) {
      const sp = normalizeFootballRecoverySport(g.sport);
      if (sp) return sp;
    }
  }
  return null;
}

/** Belt picks; drop missing/unknown sport unless metadata resolves inside scope. */
export function filterPicksByAllowedSports<
  T extends { sport?: string | null; game?: string | null },
>(
  picks: readonly T[],
  scope: CoachAskSportScope,
  espnGames?: readonly { sport?: string | null; name?: string | null; shortName?: string | null; homeTeam?: string | null; awayTeam?: string | null }[],
): T[] {
  if (!scope.allowedSports?.length) return [];
  return picks.filter((p) => {
    const resolved =
      normalizeFootballRecoverySport(p.sport) ||
      resolveAuthoritativeCandidateSport({
        sport: p.sport,
        game: p.game,
        espnGames,
      });
    return rowMatchesAllowedSports(resolved, scope);
  });
}
