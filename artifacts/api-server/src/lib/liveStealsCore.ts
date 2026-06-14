// ───────────────────────────────────────────────────────────────────────────
// "+500 Steals" — PURE core (no db / no network / no route imports) so it can be
// unit-tested with `node --test`. The impure layer (fetch / persist / grade /
// cron) lives in liveSteals.ts and re-exports from here.
//
// HONESTY: a steal is surfaced ONLY when the feed already carries a real de-vig
// edge for it (game lines: odds.ts per-outcome noVigFair/edge at ANY price;
// props: props.ts ev/edge, computed only for prices ≤ +600). Nothing is
// fabricated; the W/L ledger settles with the exact same real-result grader the
// rest of the app uses (gradeLegs).
// ───────────────────────────────────────────────────────────────────────────

// Longshot price band (American odds). The high end is intentionally generous,
// but the edge/EV guards below mean extreme longshots almost never qualify (a
// real ≥1-pt de-vig edge AND a believable ≤50% EV can't coexist at +20000), so
// they're honestly omitted rather than surfaced as fake "value".
export const STEAL_MIN_ODDS = 500;
export const STEAL_MAX_ODDS = 30000;
// De-vig edge guard (percentage points) — same spirit as the app's existing
// value-bet cap: below MIN there's no real edge; above MAX the line is almost
// certainly stale/garbage, not a genuine steal.
export const MIN_EDGE_PTS = 1;
export const MAX_EDGE_PTS = 12;
// EV% guard for display sanity (filters absurd longshot EVs from thin pricing).
export const MIN_EV = 2;
export const MAX_EV = 50;

// Sports scanned for game-line steals (any two-sided main market w/ a real edge).
export const STEAL_SPORTS = ["nba", "wnba", "mlb", "nhl", "nfl", "ncaaf", "ncaab", "soccer"];
// Sports whose props endpoint we additionally fan out to (props carry EV only on
// MAIN lines and only for prices ≤ +600, so they cover the +500..+600 slice).
export const PROP_STEAL_SPORTS = ["nba", "wnba", "mlb", "nhl", "nfl", "ncaaf", "ncaab", "soccer"];
// Bound the (expensive) per-event prop fan-out across all sports.
export const MAX_PROP_GAMES = 12;
// Only consider games tipping within this window (matches the app's pickable
// horizon); steals days out are stale and unactionable.
export const NEAR_TERM_MS = 48 * 60 * 60 * 1000;

export const FRESH_TTL_MS = 5 * 60 * 1000;
export const MAX_STEALS = 40;
// A pending steal that still can't be settled this long after tip-off is given
// up on as "ungraded" (kept out of W/L) instead of pending forever.
export const GIVE_UP_MS = 5 * 24 * 60 * 60 * 1000;

// Map a prop market KEY (Odds API) → the human stat label the grader/StatMuse
// expects. Mirrors the mobile client's PROP_MARKET_LABELS so a stored steal leg
// grades identically. (Steals come from MAIN, non-period lines only.)
const PROP_MARKET_LABELS: Record<string, string> = {
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
  player_threes: "3-Pointers",
  player_points_rebounds_assists: "Pts+Reb+Ast",
  player_points_rebounds: "Pts+Reb",
  player_points_assists: "Pts+Ast",
  player_rebounds_assists: "Reb+Ast",
  player_blocks: "Blocks",
  player_steals: "Steals",
  player_blocks_steals: "Blocks+Steals",
  player_turnovers: "Turnovers",
  player_pass_yds: "Pass Yds",
  player_pass_tds: "Pass TDs",
  player_rush_yds: "Rush Yds",
  player_reception_yds: "Rec Yds",
  player_receptions: "Receptions",
  player_anytime_td: "Anytime TD",
  player_goals: "Goals",
  player_shots_on_goal: "Shots on Goal",
  player_goal_scorer_anytime: "Anytime Goal",
  player_shots_on_target: "Shots on Target",
  player_shots: "Shots",
  batter_hits: "Hits",
  batter_total_bases: "Total Bases",
  batter_home_runs: "Home Runs",
  batter_stolen_bases: "Stolen Bases",
  player_sacks: "Sacks",
  pitcher_strikeouts: "Strikeouts",
};

export function propMarketLabel(key: string): string {
  return (
    PROP_MARKET_LABELS[key] ??
    key.replace(/^(player_|batter_|pitcher_)/, "").replace(/_/g, " ")
  );
}

// ── pure helpers ───────────────────────────────────────────────────────────
export function inStealBand(price: number | null | undefined): boolean {
  return price != null && price >= STEAL_MIN_ODDS && price <= STEAL_MAX_ODDS;
}

export function americanToDecimal(a: number): number {
  return a > 0 ? a / 100 + 1 : 100 / -a + 1;
}

// EV% of a price given a real fair win probability (0..1). null when unknown.
export function evPct(fairProb: number | null | undefined, price: number | null | undefined): number | null {
  if (fairProb == null || price == null) return null;
  return Math.round((fairProb * americanToDecimal(price) - 1) * 1000) / 10;
}

function fmtSignedPoint(point: number): string {
  return point > 0 ? `+${point}` : `${point}`;
}

// Stable id so re-surfacing the same steal across refreshes never duplicates and
// never overwrites an already-graded row. KEYED ON eventId (not the "Away @ Home"
// string) so the SAME pick in a recurring matchup — series games on different
// dates, MLB doubleheaders — is logged & graded as a DISTINCT attempt instead of
// being silently dropped by onConflictDoNothing (which would undercount the W/L
// record). The eventId is stable across refreshes of the same game.
export function stealKey(sport: string, eventId: string, market: string, pick: string): string {
  return [sport, eventId, market, pick].join("|").toLowerCase().replace(/\s+/g, " ").trim();
}

export type Steal = {
  id: string;
  sport: string;
  game: string;
  market: string;
  pick: string;
  player: string | null;
  price: number;
  edge: number | null;
  ev: number | null;
  fairProb: number | null;
  startsAt: string | null;
};

// Accept a steal only when BOTH guards pass (real edge + believable EV).
function passesGuards(edge: number | null, ev: number | null): boolean {
  if (edge == null || ev == null) return false;
  return edge >= MIN_EDGE_PTS && edge <= MAX_EDGE_PTS && ev >= MIN_EV && ev <= MAX_EV;
}

// ── odds / props feed shapes (subset we read) ───────────────────────────────
export type OddsOutcome = {
  name: string;
  price: number;
  point: number | null;
  noVigFair?: number | null;
  edge?: number | null;
};
export type OddsRow = {
  id: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  markets: Array<{ key: string; outcomes: OddsOutcome[] }>;
};

export type FeedProp = {
  player: string;
  market: string;
  line: number | null;
  overPrice: number | null;
  underPrice: number | null;
  ev?: number | null;
  evSide?: "Over" | "Under" | null;
  fairProb?: number | null;
  edge?: number | null;
};
export type PropGame = { eventId: string; game: string; sport: string; startsAt: string; props: FeedProp[] };

const GAME_MARKET_LABEL: Record<string, string> = {
  h2h: "Moneyline",
  spreads: "Spread",
  totals: "Total",
};

// Build a steal from a single game-line outcome (any price) carrying a real edge.
export function findGameSteals(rows: OddsRow[]): Steal[] {
  const out: Steal[] = [];
  for (const g of rows) {
    const game = `${g.awayTeam} @ ${g.homeTeam}`;
    for (const m of g.markets) {
      const label = GAME_MARKET_LABEL[m.key];
      if (!label) continue; // mains only (skip alt/period markets)
      for (const o of m.outcomes) {
        if (!inStealBand(o.price)) continue;
        const ev = evPct(o.noVigFair, o.price);
        if (!passesGuards(o.edge ?? null, ev)) continue;
        let pick: string;
        if (m.key === "h2h") pick = `${o.name} ML`;
        else if (m.key === "spreads") pick = o.point != null ? `${o.name} ${fmtSignedPoint(o.point)}` : `${o.name}`;
        else pick = o.point != null ? `${o.name} ${o.point}` : `${o.name}`; // totals: "Over 9.5"
        out.push({
          id: stealKey(g.sport, g.id, label, pick),
          sport: g.sport,
          game,
          market: label,
          pick,
          player: null,
          price: o.price,
          edge: o.edge ?? null,
          ev,
          fairProb: o.noVigFair ?? null,
          startsAt: g.commenceTime,
        });
      }
    }
  }
  return out;
}

// Build steals from props: the longshot side is whichever side carries the EV
// AND prices in-band. props.ts only computes ev/edge for MAIN lines (≤ +600).
export function findPropSteals(games: PropGame[]): Steal[] {
  const out: Steal[] = [];
  for (const pg of games) {
    for (const p of pg.props) {
      if (p.line == null || !p.evSide) continue;
      const sidePrice = p.evSide === "Over" ? p.overPrice : p.underPrice;
      if (!inStealBand(sidePrice)) continue;
      const ev = p.ev ?? evPct(p.fairProb ?? null, sidePrice);
      if (!passesGuards(p.edge ?? null, ev)) continue;
      const label = propMarketLabel(p.market);
      const pick = `${p.player} ${p.evSide} ${p.line} ${label}`;
      out.push({
        id: stealKey(pg.sport, pg.eventId, label, pick),
        sport: pg.sport,
        game: pg.game,
        market: label,
        pick,
        player: p.player,
        price: sidePrice as number,
        edge: p.edge ?? null,
        ev,
        fairProb: p.fairProb ?? null,
        startsAt: pg.startsAt,
      });
    }
  }
  return out;
}

// A "+500 steal" is a PREGAME longshot: once the game starts its pregame line is
// frozen and can no longer be taken, so a started/in-progress/over game must drop
// out of the LIVE pool. It was already captured in the ledger while pregame and
// settles after tip-off via gradePending — dropping it here never loses a result.
// Surface only games that have NOT started yet and tip within the pickable horizon.
export function nearTerm(commence: string, now: number): boolean {
  const t = Date.parse(commence);
  return !Number.isNaN(t) && t > now && t < now + NEAR_TERM_MS;
}
