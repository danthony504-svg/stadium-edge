/**
 * Seeded Coach prompt/sequence fuzz generator (deterministic).
 * Large suite is parser/state-only — no live API calls.
 */

import { EXPLICIT_MARKET_LOCK_RULES } from "../explicitMarketLock.ts";
import { COACH_QA_SPORTS } from "./sportsIds.ts";
import { checkSequentialTransition } from "./invariants.ts";
import { snapshotAsk } from "./parseSnapshot.ts";
import type { QaCaseResult } from "./types.ts";

/** Mulberry32 — deterministic PRNG from a 32-bit seed. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length]!;
}

const LEGS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const TEAMS = [
  { sport: "nhl", name: "Ducks" },
  { sport: "nhl", name: "Rangers" },
  { sport: "nfl", name: "Chiefs" },
  { sport: "nfl", name: "Cowboys" },
  { sport: "mlb", name: "Yankees" },
  { sport: "mlb", name: "Dodgers" },
  { sport: "nba", name: "Lakers" },
  { sport: "nba", name: "Celtics" },
  { sport: "soccer", name: "Arsenal" },
];
const DATES = ["", " tonight", " today", " tomorrow"];
const TEMPLATES = [
  (n: number, sport: string, extra: string) => `${n} leg ${sport}${extra}`,
  (n: number, sport: string, extra: string) => `give me ${n} ${sport} picks${extra}`,
  (n: number, sport: string, extra: string) => `build a ${n} leg ${sport} parlay${extra}`,
  (n: number, sport: string, extra: string) => `${n} picks ${sport}${extra}`,
  (n: number, _sport: string, extra: string) => `${n} leg${extra}`,
];

function randomAsk(rng: () => number): string {
  const n = pick(rng, LEGS);
  const mode = Math.floor(rng() * 8);
  if (mode === 0) return `${n} leg`;
  if (mode === 1) {
    const sport = pick(rng, COACH_QA_SPORTS);
    return pick(rng, TEMPLATES)(n, sport, pick(rng, DATES));
  }
  if (mode === 2) {
    const rule = pick(rng, EXPLICIT_MARKET_LOCK_RULES);
    return `${n} leg ${rule.label}`;
  }
  if (mode === 3) {
    const sport = pick(rng, COACH_QA_SPORTS);
    return `${n} leg ${sport} player props`;
  }
  if (mode === 4) {
    const sport = pick(rng, COACH_QA_SPORTS);
    return `${n} leg ${sport} game lines only`;
  }
  if (mode === 5) {
    const t = pick(rng, TEAMS);
    return `${n} leg ${t.sport.toUpperCase()} no ${t.name}`;
  }
  if (mode === 6) {
    const t = pick(rng, TEAMS);
    return `${n} leg ${t.name}`;
  }
  return `${n} leg mixed sports`;
}

function resetHints(first: string, second: string): string[] {
  const must: string[] = ["legs", "marketLock"];
  // Bare second always resets props/sport/team
  if (/^\d{1,3}\s*[-\s]?\s*legs?$/i.test(second.trim())) {
    must.push("propsOnly", "sport", "teamInclude", "teamExclude");
  } else {
    must.push("propsOnly", "teamExclude");
    if (/\b(tonight|today|tomorrow)\b/i.test(second)) must.push("slateDay");
  }
  // Sport change
  if (/\b(nfl|nhl|nba|mlb|soccer|ncaaf|ncaab|wnba)\b/i.test(second)) {
    must.push("sport");
  }
  void first;
  return [...new Set(must)];
}

/**
 * Generate ≥ `count` deterministic sequential fuzz cases and evaluate state leaks.
 * Parser/state only — no provider calls.
 */
export function runFuzzSequentialSuite(
  seed = 609_2026,
  count = 1000,
): QaCaseResult[] {
  const rng = mulberry32(seed);
  const out: QaCaseResult[] = [];
  for (let i = 0; i < count; i++) {
    const caseSeed = (seed + i * 9973) >>> 0;
    const r = mulberry32(caseSeed);
    const first = randomAsk(r);
    const second = randomAsk(r);
    const must = resetHints(first, second);
    const results = checkSequentialTransition(
      `fuzz-${i}`,
      first,
      second,
      must,
      caseSeed,
    );
    // Tag suite
    for (const res of results) {
      out.push({ ...res, suite: "fuzz_sequential", meta: { ...(res.meta ?? {}), caseSeed, i } });
    }
    // Also burn one rng call so outer rng advances independently
    rng();
  }
  return out;
}

/** Generate ≥ count single-ask fuzz prompts for parser smoke (no priors). */
export function runFuzzParserSuite(seed = 609_2026, count = 500): QaCaseResult[] {
  const out: QaCaseResult[] = [];
  for (let i = 0; i < count; i++) {
    const caseSeed = (seed + i * 7919) >>> 0;
    const ask = randomAsk(mulberry32(caseSeed));
    // Import lazily via dynamic pattern — use check via snapshot only
    try {
      const snap = snapshotAsk(ask, []);
      // Sanity: legs finite when N present
      const m = ask.match(/\b(\d{1,3})\s*[-\s]?\s*l(?:eg|ag)s?\b/i);
      if (m) {
        const n = parseInt(m[1]!, 10);
        if (snap.requestedLegs !== n && !/give me|picks/i.test(ask)) {
          // give-me variants may differ; for "N leg" forms require exact
          if (/^\d/.test(ask.trim()) && snap.requestedLegs !== n) {
            out.push({
              id: `fuzz-parser-${i}`,
              suite: "fuzz_parser",
              ok: false,
              finding: {
                id: `fuzz-parser-${i}`,
                severity: "P1",
                category: "parser",
                title: "Fuzz: leg parse mismatch",
                promptOrSequence: ask,
                seed: caseSeed,
                expected: `requestedLegs=${n}`,
                actual: `requestedLegs=${snap.requestedLegs}`,
                stage: "parseRequestedLegs",
                likelyFile: "lib/coach/parseAsk.ts",
                productionAffected: true,
              },
            });
            continue;
          }
        }
      }
      // Bare N leg never locked
      if (/^\d{1,3}\s*[-\s]?\s*legs?$/i.test(ask.trim()) && (snap.isMarketLocked || snap.propsOnly)) {
        out.push({
          id: `fuzz-parser-bare-${i}`,
          suite: "fuzz_parser",
          ok: false,
          finding: {
            id: `fuzz-parser-bare-${i}`,
            severity: "P1",
            category: "parser",
            title: "Fuzz: bare N-leg not generic mix",
            promptOrSequence: ask,
            seed: caseSeed,
            expected: "propsOnly=false isMarketLocked=false",
            actual: `propsOnly=${snap.propsOnly} locked=${snap.isMarketLocked}`,
            stage: "parseCoachAskMarketConstraint",
            likelyFile: "lib/coachAskMarketFilter.ts",
            productionAffected: true,
          },
        });
        continue;
      }
      out.push({
        id: `fuzz-parser-${i}`,
        suite: "fuzz_parser",
        ok: true,
        meta: { ask, caseSeed, snap },
      });
    } catch (e) {
      out.push({
        id: `fuzz-parser-crash-${i}`,
        suite: "fuzz_parser",
        ok: false,
        finding: {
          id: `fuzz-parser-crash-${i}`,
          severity: "P0",
          category: "crash_timeout",
          title: "Fuzz: parser threw",
          promptOrSequence: ask,
          seed: caseSeed,
          expected: "no throw",
          actual: e instanceof Error ? e.message : String(e),
          stage: "snapshotAsk",
          likelyFile: "lib/coachQa/parseSnapshot.ts",
          productionAffected: true,
        },
      });
    }
  }
  return out;
}
