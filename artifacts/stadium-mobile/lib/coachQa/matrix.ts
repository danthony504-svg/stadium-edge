/**
 * Automatic Coach request matrix — legs × sports × markets × dates × teams × wording.
 */

import { EXPLICIT_MARKET_LOCK_RULES } from "../explicitMarketLock.ts";
import { COACH_QA_SPORTS } from "./sportsIds.ts";

export type MatrixCase = {
  id: string;
  ask: string;
  tags: string[];
  /** Optional documented expectation hints for invariants. */
  expect?: {
    legs?: number;
    sport?: string | null;
    propsOnly?: boolean;
    gameLinesOnly?: boolean;
    marketLocked?: boolean;
    marketFamilyIncludes?: string;
    noPositiveTeamTokens?: string[];
    hasExcludedTokens?: string[];
    slateDay?: "tonight" | "tomorrow" | null;
    /** Bare generic mix — must not inherit propsOnly/market lock. */
    bareGenericMix?: boolean;
  };
};

const LEGS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
const SPORTS = COACH_QA_SPORTS;
const DATES = ["", " tonight", " today", " tomorrow"] as const;

const TEAM_EXAMPLES: Array<{ sport: string; include: string; exclude: string; excludeAlt: string }> = [
  { sport: "nhl", include: "Rangers", exclude: "Ducks", excludeAlt: "Anaheim" },
  { sport: "nfl", include: "Chiefs", exclude: "Cowboys", excludeAlt: "Dallas" },
  { sport: "mlb", include: "Yankees", exclude: "Dodgers", excludeAlt: "Los Angeles Dodgers" },
  { sport: "nba", include: "Lakers", exclude: "Celtics", excludeAlt: "Boston" },
  { sport: "soccer", include: "Arsenal", exclude: "Chelsea", excludeAlt: "Chelsea FC" },
  { sport: "ncaaf", include: "Alabama", exclude: "Ohio State", excludeAlt: "Buckeyes" },
];

const GAME_LINE_PHRASES = [
  "game lines",
  "game lines only",
  "moneylines",
  "spreads",
  "totals",
  "team totals",
  "sides only",
  "no player props",
];

const SIDE_PHRASES = ["over", "under", "alternate", "alt lines"];

const MIXED = [
  "mixed sports",
  "multi-sport",
  "across sports",
  "all sports",
];

function wordingVariants(legs: number, sport: string, extra = ""): string[] {
  const sp = sport.toUpperCase();
  const e = extra ? ` ${extra}` : "";
  return [
    `${legs} leg ${sp}${e}`,
    `give me ${legs} ${sp} picks${e}`,
    `build a ${legs} leg ${sp} parlay${e}`,
    `${legs} picks ${sp}${e}`,
    `${legs}-leg ${sp}${e}`,
  ];
}

/** Generate the full static matrix (deduped by ask text). */
export function generateRequestMatrix(): MatrixCase[] {
  const out: MatrixCase[] = [];
  const seen = new Set<string>();

  const push = (c: MatrixCase) => {
    const key = c.ask.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };

  // Generic N-leg (no sport)
  for (const n of LEGS) {
    push({
      id: `generic-${n}`,
      ask: `${n} leg`,
      tags: ["generic", "legs", `n${n}`],
      expect: { legs: n, sport: null, propsOnly: false, marketLocked: false, bareGenericMix: true },
    });
    push({
      id: `generic-parlay-${n}`,
      ask: `build a ${n} leg parlay`,
      tags: ["generic", "parlay", `n${n}`],
      expect: { legs: n, marketLocked: false },
    });
  }

  // Sport-specific × legs × dates
  for (const sport of SPORTS) {
    for (const n of [5, 6, 7, 8, 10, 12, 15]) {
      for (const date of DATES) {
        const ask = `${n} leg ${sport}${date}`.replace(/\s+/g, " ").trim();
        push({
          id: `sport-${sport}-${n}${date.trim() || "-nodate"}`,
          ask,
          tags: ["sport", sport, `n${n}`, date.trim() || "nodate"],
          expect: {
            legs: n,
            sport,
            // Sport-scoped N-leg is full-board mix — never imply player props.
            propsOnly: false,
            marketLocked: false,
            slateDay: date.includes("tomorrow")
              ? "tomorrow"
              : date.includes("tonight") || date.includes("today")
                ? "tonight"
                : null,
          },
        });
        for (const w of wordingVariants(n, sport, date.trim())) {
          push({
            id: `wording-${sport}-${n}-${w.slice(0, 40)}`,
            ask: w.replace(/\s+/g, " ").trim(),
            tags: ["wording", sport, `n${n}`],
            expect: { legs: n, sport, propsOnly: false, marketLocked: false },
          });
        }
      }

      // Player props / game lines
      push({
        id: `props-${sport}-${n}`,
        ask: `${n} leg ${sport} player props`,
        tags: ["player_props", sport, `n${n}`],
        expect: { legs: n, sport, propsOnly: true, marketLocked: false },
      });
      for (const gl of GAME_LINE_PHRASES) {
        push({
          id: `gl-${sport}-${n}-${gl}`,
          ask: `${n} leg ${sport} ${gl}`,
          tags: ["game_lines", sport, gl, `n${n}`],
          expect: { legs: n, sport },
        });
      }
      for (const side of SIDE_PHRASES) {
        push({
          id: `side-${sport}-${n}-${side}`,
          ask: `${n} leg ${sport} ${side}`,
          tags: ["side", sport, side, `n${n}`],
          expect: { legs: n, sport },
        });
      }
    }
  }

  // Explicit market families (from EXPLICIT_MARKET_LOCK_RULES)
  for (const rule of EXPLICIT_MARKET_LOCK_RULES) {
    const sample = rule.label;
    for (const n of [5, 6, 8, 10]) {
      push({
        id: `lock-${rule.id}-${n}`,
        ask: `${n} leg ${sample}`,
        tags: ["market_lock", rule.id, `n${n}`],
        expect: {
          legs: n,
          propsOnly: true,
          marketLocked: true,
          marketFamilyIncludes: rule.markets[0],
        },
      });
      push({
        id: `lock-over-${rule.id}-${n}`,
        ask: `${n} leg ${sample} overs`,
        tags: ["market_lock", "over", rule.id],
        expect: { legs: n, marketLocked: true },
      });
      push({
        id: `lock-under-${rule.id}-${n}`,
        ask: `${n} leg ${sample} unders`,
        tags: ["market_lock", "under", rule.id],
        expect: { legs: n, marketLocked: true },
      });
      push({
        id: `lock-alt-${rule.id}-${n}`,
        ask: `${n} leg alternate ${sample}`,
        tags: ["market_lock", "alternate", rule.id],
        expect: { legs: n, marketLocked: true },
      });
    }
  }

  // Mixed sports
  for (const n of [6, 8, 10, 12]) {
    for (const m of MIXED) {
      push({
        id: `mix-${n}-${m}`,
        ask: `${n} leg ${m}`,
        tags: ["mixed", `n${n}`],
        expect: { legs: n, propsOnly: false, marketLocked: false, bareGenericMix: true },
      });
    }
  }

  // Team inclusion / exclusion
  for (const t of TEAM_EXAMPLES) {
    for (const n of [5, 6, 8]) {
      push({
        id: `include-${t.sport}-${t.include}-${n}`,
        ask: `${n} leg ${t.include}`,
        tags: ["team_include", t.sport, `n${n}`],
        expect: { legs: n, sport: t.sport },
      });
      push({
        id: `exclude-${t.sport}-${t.exclude}-${n}`,
        ask: `${n} leg ${t.sport.toUpperCase()} no ${t.exclude}`,
        tags: ["team_exclude", t.sport, `n${n}`],
        expect: {
          legs: n,
          sport: t.sport,
          hasExcludedTokens: [t.exclude.toLowerCase()],
          noPositiveTeamTokens: [t.exclude.toLowerCase()],
        },
      });
      push({
        id: `exclude-not-${t.sport}-${t.exclude}-${n}`,
        ask: `${n} leg ${t.sport.toUpperCase()} not ${t.exclude}`,
        tags: ["team_exclude", t.sport],
        expect: { legs: n, hasExcludedTokens: [t.exclude.toLowerCase()] },
      });
      push({
        id: `exclude-without-${t.sport}-${t.exclude}-${n}`,
        ask: `${n} ${t.sport.toUpperCase()} picks without the ${t.exclude}`,
        tags: ["team_exclude", "wording"],
        expect: { legs: n, hasExcludedTokens: [t.exclude.toLowerCase()] },
      });
      push({
        id: `exclude-altname-${t.sport}-${n}`,
        ask: `${n} leg ${t.sport.toUpperCase()} not ${t.excludeAlt}`,
        tags: ["team_exclude", "alt_name"],
        expect: { legs: n },
      });
      // Combination: date + exclude
      push({
        id: `combo-${t.sport}-${n}-tonight-ex`,
        ask: `${n} leg ${t.sport.toUpperCase()} tonight no ${t.exclude}`,
        tags: ["combo", "date", "exclude", t.sport],
        expect: {
          legs: n,
          sport: t.sport,
          slateDay: "tonight",
          hasExcludedTokens: [t.exclude.toLowerCase()],
          noPositiveTeamTokens: [t.exclude.toLowerCase()],
        },
      });
    }
  }

  // Multi-exclusion
  push({
    id: "multi-ex-nhl",
    ask: "8 leg NHL tonight no Ducks no Bruins",
    tags: ["multi_exclude", "nhl"],
    expect: {
      legs: 8,
      sport: "nhl",
      slateDay: "tonight",
      noPositiveTeamTokens: ["ducks", "bruins"],
    },
  });

  // Periods / halves / quarters
  for (const period of ["1st half", "2nd half", "1st quarter", "Q1", "period 1", "P1"]) {
    push({
      id: `period-${period}`,
      ask: `6 leg NFL ${period}`,
      tags: ["period", "nfl"],
      expect: { legs: 6, sport: "nfl" },
    });
  }

  return out;
}

/** Hand-picked sequential transition pairs for state-leak torture. */
export function sequentialTransitionSeeds(): Array<{
  id: string;
  first: string;
  second: string;
  /** What must NOT leak from first → second. */
  mustReset: Array<
    | "propsOnly"
    | "marketLock"
    | "sport"
    | "teamInclude"
    | "teamExclude"
    | "slateDay"
    | "legs"
  >;
  notes?: string;
}> {
  return [
    {
      id: "td-to-bare",
      first: "5 leg touchdowns",
      second: "5 leg",
      mustReset: ["propsOnly", "marketLock", "sport"],
      notes: "Bare follow-up must be generic full-board mix",
    },
    {
      id: "playerprops-to-10",
      first: "7 leg player props",
      second: "10 leg",
      mustReset: ["propsOnly", "marketLock"],
      notes: "Bare N-leg must not stay props-only",
    },
    {
      id: "nhl-exclude-to-nhl",
      first: "6 leg NHL no Ducks",
      second: "6 leg NHL",
      mustReset: ["teamExclude"],
    },
    {
      id: "passyds-to-nba",
      first: "5 leg passing yards",
      second: "7 leg NBA",
      mustReset: ["marketLock", "propsOnly", "sport"],
    },
    {
      id: "soccer-to-bare",
      first: "4 leg soccer",
      second: "5 leg",
      mustReset: ["propsOnly", "sport", "marketLock"],
      notes: "Screenshot regression — soccer N-leg must not make bare 5 leg props-only",
    },
    {
      id: "playerprops-mlb-to-mlb-mix",
      first: "7 player props MLB",
      second: "7 leg MLB",
      mustReset: ["propsOnly", "marketLock"],
      notes: "Phone: props→sport N-leg must reset to full_board_mix",
    },
    {
      id: "soccer-to-mlb-mix",
      first: "4 leg soccer",
      second: "7 leg MLB",
      mustReset: ["propsOnly", "sport", "marketLock"],
      notes: "Sport follow-up after soccer is mix, not props-only",
    },
    {
      id: "mlb-mix-to-bare",
      first: "7 leg MLB",
      second: "7 leg",
      mustReset: ["propsOnly", "sport", "marketLock"],
      notes: "Bare N-leg after sport mix stays mix",
    },
    {
      id: "tomorrow-to-today",
      first: "7 leg tomorrow",
      second: "7 leg today",
      mustReset: ["slateDay"],
    },
    {
      id: "yankees-to-bare",
      first: "5 leg Yankees",
      second: "5 leg",
      mustReset: ["teamInclude", "sport", "propsOnly"],
    },
    {
      id: "sacks-to-bare",
      first: "5 leg sacks",
      second: "5 leg",
      mustReset: ["marketLock", "propsOnly"],
    },
    {
      id: "hr-to-bare",
      first: "6 leg home runs",
      second: "6 leg",
      mustReset: ["marketLock", "propsOnly"],
    },
    {
      id: "nfl-props-to-bare",
      first: "9 leg nfl props",
      second: "5 leg",
      mustReset: ["propsOnly", "sport"],
    },
  ];
}
