/**
 * Phase B — define FINAL_EVAL membership + exclusions from free ESPN.
 * Builds chronological prior-state recipe (pre-kickoff only).
 * Seals FINAL_EVAL outcomes from model selection. Does NOT score FINAL_EVAL.
 * No Odds spend.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isFbsFbsGame } from "../src/lib/sportSim/ncaafSubdivision.ts";
import type { CleanFixtureGameRow } from "../src/lib/sportSim/ncaafClean/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "../test/fixtures");
const DOCS = join(HERE, "../../../docs/coach");

const TUNING_CUTOFF = "2025-10-15T00:00:00Z";
const ESPN =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";

type EspnEvent = {
  id?: string;
  date?: string;
  name?: string;
  season?: { year?: number };
  week?: { number?: number };
  competitions?: Array<{
    neutralSite?: boolean;
    status?: { type?: { name?: string; completed?: boolean } };
    competitors?: Array<{
      homeAway?: string;
      id?: string;
      score?: string;
      team?: { id?: string; displayName?: string };
      winner?: boolean;
    }>;
  }>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWeek(
  year: number,
  week: number,
  seasontype = 2,
): Promise<EspnEvent[]> {
  const url = `${ESPN}?dates=${year}&seasontype=${seasontype}&week=${week}&limit=300`;
  const res = await fetch(url, {
    headers: { "User-Agent": "stadium-edge-final-eval-membership/1.0" },
  });
  if (!res.ok) {
    console.warn(`ESPN week ${year} w${week} HTTP ${res.status}`);
    return [];
  }
  const d = (await res.json()) as { events?: EspnEvent[] };
  return d.events ?? [];
}

function toRow(ev: EspnEvent): CleanFixtureGameRow | null {
  const comp = ev.competitions?.[0];
  if (!comp || !ev.id || !ev.date) return null;
  const home = comp.competitors?.find((c) => c.homeAway === "home");
  const away = comp.competitors?.find((c) => c.homeAway === "away");
  if (!home || !away) return null;
  const homeId = String(home.team?.id ?? home.id ?? "");
  const awayId = String(away.team?.id ?? away.id ?? "");
  if (!homeId || !awayId) return null;
  const completed = comp.status?.type?.completed === true;
  const homeFg =
    completed && home.score != null && home.score !== ""
      ? Number(home.score)
      : null;
  const awayFg =
    completed && away.score != null && away.score !== ""
      ? Number(away.score)
      : null;
  return {
    eventId: String(ev.id),
    season: ev.season?.year ?? yearFromDate(ev.date),
    week: ev.week?.number ?? null,
    kickoffIso: ev.date.endsWith("Z") ? ev.date : `${ev.date}Z`,
    homeTeamId: homeId,
    awayTeamId: awayId,
    homeName: home.team?.displayName ?? "Home",
    awayName: away.team?.displayName ?? "Away",
    homeFg: Number.isFinite(homeFg as number) ? homeFg : null,
    awayFg: Number.isFinite(awayFg as number) ? awayFg : null,
    venueKind: comp.neutralSite === true ? "neutral" : "home",
  };
}

function yearFromDate(iso: string): number {
  return Number(iso.slice(0, 4));
}

function loadTuning(): CleanFixtureGameRow[] {
  const p = join(FIX, "ncaaf-tuning-2025-w1-7-games.json");
  return (JSON.parse(readFileSync(p, "utf8")) as { games: CleanFixtureGameRow[] })
    .games;
}

function loadPhaseE2024(): CleanFixtureGameRow[] {
  const p = join(FIX, "ncaaf-phase-e-games.json");
  const doc = JSON.parse(readFileSync(p, "utf8")) as
    | { games: CleanFixtureGameRow[] }
    | CleanFixtureGameRow[];
  const games = Array.isArray(doc) ? doc : doc.games;
  return games.filter((g) => g.season === 2024);
}

async function main(): Promise<void> {
  const events: EspnEvent[] = [];
  // 2025 regular season weeks 8–15
  for (let w = 8; w <= 15; w++) {
    events.push(...(await fetchWeek(2025, w, 2)));
    await sleep(120);
  }
  // 2026 regular season weeks 1–15 (keep completed only later)
  for (let w = 1; w <= 15; w++) {
    events.push(...(await fetchWeek(2026, w, 2)));
    await sleep(120);
  }

  const byId = new Map<string, CleanFixtureGameRow>();
  for (const ev of events) {
    const row = toRow(ev);
    if (!row) continue;
    byId.set(row.eventId, row);
  }

  const tuning = loadTuning();
  const tuningIds = new Set(tuning.map((g) => String(g.eventId)));

  type Member = {
    eventId: string;
    season: number;
    week: number | null;
    kickoffIso: string;
    homeTeamId: string;
    awayTeamId: string;
    homeName: string;
    awayName: string;
    venueKind: string | null | undefined;
    completed: boolean;
    matchupSubdivision: "fbs_fbs" | "non_fbs_fbs" | "unknown";
    inclusion: "included" | "excluded";
    exclusionReason: string | null;
    /** Outcomes sealed from model selection — present for causal state only. */
    sealedOutcome: { homeFg: number | null; awayFg: number | null };
  };

  const members: Member[] = [];
  for (const g of byId.values()) {
    const kick = g.kickoffIso;
    let inclusion: "included" | "excluded" = "included";
    let exclusionReason: string | null = null;

    if (tuningIds.has(String(g.eventId))) {
      inclusion = "excluded";
      exclusionReason = "in_TUNING_split";
    } else if (g.season === 2025 && kick < TUNING_CUTOFF) {
      inclusion = "excluded";
      exclusionReason = "before_TUNING_cutoff_should_be_tuning";
    } else if (g.season === 2025 && (g.week == null || g.week < 8)) {
      // kickoff after cutoff but week tag <8 — still FINAL_EVAL by kickoff rule
    } else if (g.season === 2026 && (g.homeFg == null || g.awayFg == null)) {
      inclusion = "excluded";
      exclusionReason = "2026_not_completed";
    } else if (g.season !== 2025 && g.season !== 2026) {
      inclusion = "excluded";
      exclusionReason = "outside_FINAL_EVAL_seasons";
    }

    const fbs = isFbsFbsGame(g.homeTeamId, g.awayTeamId, g.season);
    const subdiv = fbs ? "fbs_fbs" : "non_fbs_fbs";
    if (inclusion === "included" && !fbs) {
      // keep in membership list but flag unsupported for ML scoring later
    }

    members.push({
      eventId: String(g.eventId),
      season: g.season,
      week: g.week ?? null,
      kickoffIso: kick,
      homeTeamId: g.homeTeamId,
      awayTeamId: g.awayTeamId,
      homeName: g.homeName,
      awayName: g.awayName,
      venueKind: g.venueKind ?? null,
      completed: g.homeFg != null && g.awayFg != null,
      matchupSubdivision: subdiv,
      inclusion,
      exclusionReason:
        inclusion === "excluded"
          ? exclusionReason
          : !fbs
            ? "fbs_fcs_or_non_fbs_unsupported_scope"
            : null,
      sealedOutcome: { homeFg: g.homeFg ?? null, awayFg: g.awayFg ?? null },
    });
    if (inclusion === "included" && !fbs) {
      members[members.length - 1]!.inclusion = "excluded";
      members[members.length - 1]!.exclusionReason =
        "fbs_fcs_or_non_fbs_unsupported_scope";
    }
  }

  members.sort((a, b) => a.kickoffIso.localeCompare(b.kickoffIso));

  const included = members.filter((m) => m.inclusion === "included");
  const excluded = members.filter((m) => m.inclusion === "excluded");
  const exclusionCounts: Record<string, number> = {};
  for (const m of excluded) {
    const r = m.exclusionReason ?? "unknown";
    exclusionCounts[r] = (exclusionCounts[r] ?? 0) + 1;
  }

  const causalStateRecipe = {
    rule: "Pre-kickoff ratings only: seed 2024 FBS–FBS → update chronologically through TUNING + any FINAL_EVAL games with kickoff < target kickoff. Never use target game sealedOutcome in predict. Never use FINAL_EVAL outcomes for α/param selection (α frozen at 1.15).",
    seed: "ncaaf-phase-e-games.json season=2024",
    priorWalk: "ncaaf-tuning-2025-w1-7-games.json (full chronological update)",
    finalEvalWalk:
      "included FINAL_EVAL members sorted by kickoff; update after predict using sealedOutcome only for state carry-forward — not for selection",
    selectionIsolation:
      "outcomeSealed=true on FINAL_EVAL rows; harness allowFinalEvalScoring=false until authorized",
    scoring: "NOT RUN this turn",
  };

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "B",
    paidRetrieval: false,
    finalEvalScored: false,
    membershipRules: {
      TUNING: `kickoff < ${TUNING_CUTOFF} (2025 w1–7)`,
      FINAL_EVAL_2025: `season=2025 AND kickoff >= ${TUNING_CUTOFF} (weeks 8+)`,
      FINAL_EVAL_2026: "season=2026 regular-season AND completed (homeFg/awayFg present)",
      fbsScope: "ML scoring later requires verified FBS–FBS; non-FBS excluded here",
    },
    source: "espn_site_scoreboard_v2 free",
    nFetchedEvents: byId.size,
    nIncluded: included.length,
    nExcluded: excluded.length,
    exclusionCounts,
    nIncludedCompleted: included.filter((m) => m.completed).length,
    firstKickoff: included[0]?.kickoffIso ?? null,
    lastKickoff: included[included.length - 1]?.kickoffIso ?? null,
    causalStateRecipe,
    seedGamesAvailable: loadPhaseE2024().length,
    tuningGamesAvailable: tuning.length,
    /** Membership rows — sealedOutcome must not feed model selection. */
    members,
    ops: {
      voice: "paused",
      spreads: "blocked",
      ncaafGate: false,
      deployOta: false,
    },
  };

  writeFileSync(
    join(FIX, "ncaaf-final-eval-membership.json"),
    JSON.stringify(report, null, 2) + "\n",
  );

  // Lightweight games list for later causal walks (outcomes present but flagged sealed)
  const gamesOut = {
    generatedAt: report.generatedAt,
    split: "FINAL_EVAL_MEMBERSHIP",
    scored: false,
    note: "Outcomes present for causal state carry-forward only; outcomeSealed=true; do not use for selection or acceptance scoring until authorized",
    games: included.map((m) => ({
      eventId: m.eventId,
      season: m.season,
      week: m.week,
      kickoffIso: m.kickoffIso,
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      homeName: m.homeName,
      awayName: m.awayName,
      venueKind: m.venueKind,
      homeFg: m.sealedOutcome.homeFg,
      awayFg: m.sealedOutcome.awayFg,
      outcomeSealed: true,
    })),
  };
  writeFileSync(
    join(FIX, "ncaaf-final-eval-membership-games.json"),
    JSON.stringify(gamesOut, null, 2) + "\n",
  );

  const md = `# FINAL_EVAL membership (Phase B) — free ESPN, unscored

**Generated:** ${report.generatedAt}  
**Paid retrieval:** false · **FINAL_EVAL scored:** false  
**Spreads:** blocked · voice paused · gate false

## Membership rules (locked before scoring)

| Split | Rule |
|-------|------|
| TUNING | kickoff &lt; ${TUNING_CUTOFF} |
| FINAL_EVAL 2025 | season=2025 ∧ kickoff ≥ ${TUNING_CUTOFF} |
| FINAL_EVAL 2026 | season=2026 RS ∧ completed |
| Scope | Verified FBS–FBS only for later ML scoring |

## Counts

| Item | n |
|------|--:|
| ESPN events fetched | ${report.nFetchedEvents} |
| **Included** | **${report.nIncluded}** |
| Excluded | ${report.nExcluded} |
| Included completed | ${report.nIncludedCompleted} |

### Exclusions

\`\`\`json
${JSON.stringify(exclusionCounts, null, 2)}
\`\`\`

## Causal state (pre-kickoff only)

${causalStateRecipe.rule}

1. Seed: phase-e 2024 (n=${report.seedGamesAvailable})  
2. Walk TUNING 2025 w1–7 (n=${report.tuningGamesAvailable})  
3. Walk included FINAL_EVAL by kickoff — update **after** predict using sealed outcomes for carry-forward only  
4. **Do not** use sealed outcomes for α/param selection (α=1.15 frozen)  
5. **Do not** run M1–M4 on FINAL_EVAL this turn  

## Fixtures

- \`ncaaf-final-eval-membership.json\` — full membership + exclusions  
- \`ncaaf-final-eval-membership-games.json\` — included games with \`outcomeSealed=true\`  
`;

  writeFileSync(join(FIX, "ncaaf-final-eval-membership.md"), md);
  writeFileSync(join(DOCS, "ncaaf-final-eval-membership.md"), md);

  // Prove harness refuses FINAL_EVAL scoring on this membership
  if (existsSync(join(HERE, "ncaafCleanMlOnlyHarness.ts"))) {
    // imported dynamically in separate step; here just note
  }

  console.log(
    JSON.stringify(
      {
        nIncluded: report.nIncluded,
        nExcluded: report.nExcluded,
        exclusionCounts,
        first: report.firstKickoff,
        last: report.lastKickoff,
        finalEvalScored: false,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
