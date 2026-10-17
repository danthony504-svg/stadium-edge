/**
 * Reconcile FINAL_EVAL membership vs complete ESPN scoreboard date walk.
 * Structural exclusions only — does NOT inspect model performance or
 * change membership based on game outcomes (except 2026-completed rule).
 * No Odds spend. No FINAL_EVAL scoring.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isFbsFbsGame } from "../src/lib/sportSim/ncaafSubdivision.ts";
import type { CleanFixtureGameRow } from "../src/lib/sportSim/ncaafClean/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "../test/fixtures");
const DOCS = join(HERE, "../../../docs/coach");

const TUNING_CUTOFF = "2025-10-15T00:00:00Z";
/** Predefined FINAL_EVAL 2025 date window (RS through mid-December). */
const FE_2025_START = "2025-10-15";
const FE_2025_END = "2025-12-15";
/** Predefined FINAL_EVAL 2026 RS window through "today" probe date. */
const FE_2026_START = "2026-08-23";
const FE_2026_END = "2026-10-17";

const ESPN =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";

type EspnEvent = {
  id?: string;
  date?: string;
  season?: { year?: number };
  week?: { number?: number };
  competitions?: Array<{
    neutralSite?: boolean;
    status?: { type?: { completed?: boolean } };
    competitors?: Array<{
      homeAway?: string;
      id?: string;
      score?: string;
      team?: { id?: string; displayName?: string };
    }>;
  }>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function* eachDate(startYmd: string, endYmd: string): Generator<string> {
  const cur = new Date(`${startYmd}T00:00:00Z`);
  const end = new Date(`${endYmd}T00:00:00Z`);
  while (cur <= end) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, "0");
    const d = String(cur.getUTCDate()).padStart(2, "0");
    yield `${y}${m}${d}`;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

async function fetchDate(ymd: string): Promise<EspnEvent[]> {
  const url = `${ESPN}?dates=${ymd}&limit=300`;
  const res = await fetch(url, {
    headers: { "User-Agent": "stadium-edge-final-eval-reconcile/1.0" },
  });
  if (!res.ok) {
    console.warn(`ESPN ${ymd} HTTP ${res.status}`);
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
    season: ev.season?.year ?? Number(ev.date.slice(0, 4)),
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
  matchupSubdivision: "fbs_fbs" | "non_fbs_fbs";
  inclusion: "included" | "excluded";
  exclusionReason: string | null;
  sealedOutcome: { homeFg: number | null; awayFg: number | null };
  scheduleSource: "espn_date_scoreboard";
};

function classify(g: CleanFixtureGameRow, tuningIds: Set<string>): Member {
  const fbs = isFbsFbsGame(g.homeTeamId, g.awayTeamId, g.season);
  let inclusion: "included" | "excluded" = "included";
  let exclusionReason: string | null = null;

  // Structural rules only — not model performance, not score-based for 2025.
  if (tuningIds.has(String(g.eventId))) {
    inclusion = "excluded";
    exclusionReason = "in_TUNING_split";
  } else if (g.season === 2025 && g.kickoffIso < TUNING_CUTOFF) {
    inclusion = "excluded";
    exclusionReason = "before_TUNING_cutoff";
  } else if (g.season === 2025 && g.kickoffIso.slice(0, 10) > FE_2025_END) {
    inclusion = "excluded";
    exclusionReason = "after_predefined_2025_window";
  } else if (g.season === 2026 && (g.homeFg == null || g.awayFg == null)) {
    inclusion = "excluded";
    exclusionReason = "2026_not_completed";
  } else if (g.season !== 2025 && g.season !== 2026) {
    inclusion = "excluded";
    exclusionReason = "outside_FINAL_EVAL_seasons";
  } else if (!fbs) {
    inclusion = "excluded";
    exclusionReason = "fbs_fcs_or_non_fbs_unsupported_scope";
  }

  return {
    eventId: String(g.eventId),
    season: g.season,
    week: g.week ?? null,
    kickoffIso: g.kickoffIso,
    homeTeamId: g.homeTeamId,
    awayTeamId: g.awayTeamId,
    homeName: g.homeName ?? "Home",
    awayName: g.awayName ?? "Away",
    venueKind: g.venueKind ?? null,
    completed: g.homeFg != null && g.awayFg != null,
    matchupSubdivision: fbs ? "fbs_fbs" : "non_fbs_fbs",
    inclusion,
    exclusionReason,
    sealedOutcome: { homeFg: g.homeFg ?? null, awayFg: g.awayFg ?? null },
    scheduleSource: "espn_date_scoreboard",
  };
}

async function main(): Promise<void> {
  const prior = JSON.parse(
    readFileSync(join(FIX, "ncaaf-final-eval-membership.json"), "utf8"),
  ) as {
    nIncluded: number;
    members: Array<{ eventId: string; inclusion: string }>;
  };
  const priorIncluded = new Set(
    prior.members.filter((m) => m.inclusion === "included").map((m) => m.eventId),
  );

  const tuning = (
    JSON.parse(
      readFileSync(join(FIX, "ncaaf-tuning-2025-w1-7-games.json"), "utf8"),
    ) as { games: CleanFixtureGameRow[] }
  ).games;
  const tuningIds = new Set(tuning.map((g) => String(g.eventId)));

  const byId = new Map<string, CleanFixtureGameRow>();
  const dates = [
    ...eachDate(FE_2025_START, FE_2025_END),
    ...eachDate(FE_2026_START, FE_2026_END),
  ];
  let di = 0;
  for (const ymd of dates) {
    const evs = await fetchDate(ymd);
    for (const ev of evs) {
      const row = toRow(ev);
      if (!row) continue;
      // Keep first sighting; date boards can repeat midweek
      if (!byId.has(row.eventId)) byId.set(row.eventId, row);
    }
    di++;
    if (di % 10 === 0) await sleep(80);
  }

  const members = [...byId.values()]
    .map((g) => classify(g, tuningIds))
    .sort((a, b) => a.kickoffIso.localeCompare(b.kickoffIso));

  const included = members.filter((m) => m.inclusion === "included");
  const excluded = members.filter((m) => m.inclusion === "excluded");
  const exclusionCounts: Record<string, number> = {};
  for (const m of excluded) {
    const r = m.exclusionReason ?? "unknown";
    exclusionCounts[r] = (exclusionCounts[r] ?? 0) + 1;
  }

  const scheduleIds = new Set(members.map((m) => m.eventId));
  const newVsPrior = included
    .filter((m) => !priorIncluded.has(m.eventId))
    .map((m) => ({
      eventId: m.eventId,
      kickoffIso: m.kickoffIso,
      week: m.week,
      matchup: `${m.awayName} @ ${m.homeName}`,
      reason: "present_on_date_scoreboard_missing_from_week_board_membership",
    }));
  const droppedVsPrior = [...priorIncluded]
    .filter((id) => {
      const m = members.find((x) => x.eventId === id);
      return !m || m.inclusion !== "included";
    })
    .map((id) => {
      const m = members.find((x) => x.eventId === id);
      return {
        eventId: id,
        status: m
          ? `now_${m.inclusion}:${m.exclusionReason}`
          : "absent_from_date_schedule_window",
      };
    });
  const stillMissingFromSchedule = [...priorIncluded].filter(
    (id) => !scheduleIds.has(id),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "B_reconcile",
    paidRetrieval: false,
    finalEvalScored: false,
    modelPerformanceInspected: false,
    membershipChangedByOutcomes: false,
    predefinedDateWindows: {
      FE_2025: { start: FE_2025_START, end: FE_2025_END },
      FE_2026: { start: FE_2026_START, end: FE_2026_END },
      TUNING_CUTOFF,
    },
    membershipRules: {
      TUNING: `kickoff < ${TUNING_CUTOFF}`,
      FINAL_EVAL_2025: `season=2025 AND kickoff >= ${TUNING_CUTOFF} AND date in [${FE_2025_START},${FE_2025_END}]`,
      FINAL_EVAL_2026: `season=2026 RS completed AND date in [${FE_2026_START},${FE_2026_END}]`,
      fbsScope: "Verified FBS–FBS only for inclusion",
      outcomePolicy:
        "2025 inclusion does not depend on finals; 2026 requires completed for membership only (not model selection)",
    },
    source: "espn_site_scoreboard_v2 date walk",
    nDatesProbed: dates.length,
    nScheduleEvents: byId.size,
    nIncluded: included.length,
    nExcluded: excluded.length,
    exclusionCounts,
    nIncludedCompleted: included.filter((m) => m.completed).length,
    firstKickoff: included[0]?.kickoffIso ?? null,
    lastKickoff: included[included.length - 1]?.kickoffIso ?? null,
    reconcileVsPriorWeekBoard: {
      priorIncludedN: priorIncluded.size,
      dateWalkIncludedN: included.length,
      newlyFoundIncluded: newVsPrior,
      nNewlyFound: newVsPrior.length,
      noLongerIncluded: droppedVsPrior,
      nNoLongerIncluded: droppedVsPrior.length,
      priorIdsAbsentFromDateWindow: stillMissingFromSchedule,
      note: "Membership updated to date-complete schedule using structural rules only — not model metrics or 2025 score-based filters",
    },
    causalStateRecipe: {
      rule: "Seed 2024 → chronological TUNING updates → FINAL_EVAL predict with pre-kickoff state only; sealedOutcome for carry-forward after predict; α=1.15 frozen; no selection on FINAL_EVAL outcomes",
      scoring: "NOT RUN",
    },
    members,
    ops: {
      e1Frozen: true,
      injuryCollector: "inactive",
      ncaafGate: false,
      voice: "paused",
      spreads: "blocked",
      deployOta: false,
    },
  };

  writeFileSync(
    join(FIX, "ncaaf-final-eval-membership.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  writeFileSync(
    join(FIX, "ncaaf-final-eval-membership-reconcile.json"),
    JSON.stringify(
      {
        generatedAt: report.generatedAt,
        predefinedDateWindows: report.predefinedDateWindows,
        reconcileVsPriorWeekBoard: report.reconcileVsPriorWeekBoard,
        exclusionCounts,
        nIncluded: report.nIncluded,
        nScheduleEvents: report.nScheduleEvents,
      },
      null,
      2,
    ) + "\n",
  );

  writeFileSync(
    join(FIX, "ncaaf-final-eval-membership-games.json"),
    JSON.stringify(
      {
        generatedAt: report.generatedAt,
        split: "FINAL_EVAL_MEMBERSHIP",
        scored: false,
        scheduleSource: "espn_date_scoreboard_reconciled",
        note: "outcomeSealed=true — causal carry-forward only; not for selection or acceptance scoring",
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
      },
      null,
      2,
    ) + "\n",
  );

  const md = `# FINAL_EVAL membership — reconciled to complete ESPN date schedule

**Generated:** ${report.generatedAt}  
**Paid retrieval:** false · **FINAL_EVAL scored:** false · model performance **not** inspected  
**E1 frozen** · injuries inactive · NCAAF blocked · voice paused · spreads blocked

## Predefined date windows

| Window | Dates |
|--------|-------|
| FINAL_EVAL 2025 | ${FE_2025_START} … ${FE_2025_END} (kickoff ≥ ${TUNING_CUTOFF}) |
| FINAL_EVAL 2026 | ${FE_2026_START} … ${FE_2026_END} (completed RS only) |

## Membership rules (structural — not outcome-tuned)

| Rule | Detail |
|------|--------|
| TUNING | kickoff &lt; ${TUNING_CUTOFF} |
| FBS scope | verified FBS–FBS for inclusion |
| 2025 | in window; inclusion **not** based on final score |
| 2026 | completed required for membership only |

## Schedule reconcile (week-board → date walk)

| Item | n |
|------|--:|
| Dates probed | ${report.nDatesProbed} |
| Schedule events | ${report.nScheduleEvents} |
| Prior week-board included | ${priorIncluded.size} |
| **Date-walk included** | **${report.nIncluded}** |
| Newly found vs prior | ${newVsPrior.length} |
| No longer included | ${droppedVsPrior.length} |
| Excluded (structural) | ${report.nExcluded} |

### Exclusion counts

\`\`\`json
${JSON.stringify(exclusionCounts, null, 2)}
\`\`\`

### Newly found (sample ≤25)

| eventId | kickoff | matchup |
|---------|---------|---------|
${newVsPrior
  .slice(0, 25)
  .map((g) => `| ${g.eventId} | ${g.kickoffIso} | ${g.matchup} |`)
  .join("\n") || "| — | — | none |"}

### Documented missing / dropped vs prior week membership

${
  droppedVsPrior.length
    ? droppedVsPrior
        .slice(0, 30)
        .map((d) => `- \`${d.eventId}\`: ${d.status}`)
        .join("\n")
    : "- none"
}

**Note:** Membership refreshed to the date-complete schedule using structural rules only. No M1–M4 / Brier / CLV numbers consulted.

## Causal state

${report.causalStateRecipe.rule} · Scoring: **NOT RUN**
`;

  writeFileSync(join(FIX, "ncaaf-final-eval-membership.md"), md);
  writeFileSync(join(DOCS, "ncaaf-final-eval-membership.md"), md);

  console.log(
    JSON.stringify(
      {
        nScheduleEvents: report.nScheduleEvents,
        nIncluded: report.nIncluded,
        priorIncluded: priorIncluded.size,
        newlyFound: newVsPrior.length,
        dropped: droppedVsPrior.length,
        exclusionCounts,
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
