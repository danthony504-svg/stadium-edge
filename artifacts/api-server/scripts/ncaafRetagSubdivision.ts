/**
 * Retag cached NCAAF games with season-specific verified FBS/FCS IDs.
 *
 * Writes sidecars (does not mutate ORIGINAL game fixtures):
 *   - ncaaf-phase-e-games.subdivision-tags.json
 *   - ncaaf-tuning-2025-w1-7-games.subdivision-tags.json
 *
 * Cache-only classification from ncaaf-subdivision-espn-ids.json.
 * FINAL_EVAL untouched. No paid Odds. No gate flip.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyMatchupSubdivision,
  classifyTeamSubdivision,
  loadSubdivisionFixture,
  type MatchupSubdivision,
  type Subdivision,
} from "../src/lib/sportSim/ncaafSubdivision.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "../test/fixtures");
const ART = "/opt/cursor/artifacts";
const DOCS = join(here, "../../../docs/coach");

type EspnGame = {
  eventId: string;
  season: number;
  week: number;
  homeTeamId: string;
  awayTeamId: string;
  homeName?: string;
  awayName?: string;
};

function retag(path: string, outName: string) {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { games: EspnGame[] };
  const games = raw.games ?? [];
  const counts: Record<MatchupSubdivision, number> = {
    fbs_fbs: 0,
    fbs_fcs: 0,
    fcs_fcs: 0,
    involves_unknown: 0,
  };
  const teamSubBySeason = new Map<string, Subdivision>();
  const rows = games.map((g) => {
    const homeSub = classifyTeamSubdivision(g.homeTeamId, g.season);
    const awaySub = classifyTeamSubdivision(g.awayTeamId, g.season);
    const matchup = classifyMatchupSubdivision(
      g.homeTeamId,
      g.awayTeamId,
      g.season,
    );
    counts[matchup] += 1;
    teamSubBySeason.set(`${g.season}:${g.homeTeamId}`, homeSub);
    teamSubBySeason.set(`${g.season}:${g.awayTeamId}`, awaySub);
    return {
      eventId: g.eventId,
      season: g.season,
      week: g.week,
      homeTeamId: g.homeTeamId,
      awayTeamId: g.awayTeamId,
      homeName: g.homeName ?? null,
      awayName: g.awayName ?? null,
      homeSubdivision: homeSub,
      awaySubdivision: awaySub,
      matchupSubdivision: matchup,
    };
  });
  const unknownTeams = [...teamSubBySeason.entries()]
    .filter(([, s]) => s === "unknown")
    .map(([k]) => k);
  const payload = {
    generatedAt: new Date().toISOString(),
    sourceGames: path.split("/").pop(),
    classification: "ncaaf-subdivision-espn-ids.json",
    note: "Sidecar tags only — original game fixtures unchanged. Unknown stays unknown.",
    counts,
    unknownTeamSeasonKeys: unknownTeams,
    nGames: rows.length,
    games: rows,
  };
  writeFileSync(join(FIX, outName), JSON.stringify(payload, null, 2));
  writeFileSync(join(ART, outName), JSON.stringify(payload, null, 2));
  return payload;
}

function main(): number {
  mkdirSync(ART, { recursive: true });
  mkdirSync(DOCS, { recursive: true });
  const fix = loadSubdivisionFixture();
  const prior = retag(
    join(FIX, "ncaaf-phase-e-games.json"),
    "ncaaf-phase-e-games.subdivision-tags.json",
  );
  const tuning = retag(
    join(FIX, "ncaaf-tuning-2025-w1-7-games.json"),
    "ncaaf-tuning-2025-w1-7-games.subdivision-tags.json",
  );

  const md: string[] = [];
  md.push("# NCAAF subdivision retag (cache-only)");
  md.push("");
  md.push(
    `**Source:** ESPN standings groups 80/81 cached in \`ncaaf-subdivision-espn-ids.json\` (fetchedAt=${fix.fetchedAt ?? "?"}).`,
  );
  md.push("**Original game fixtures:** unchanged. **FINAL_EVAL:** untouched. **Paid Odds:** none.");
  md.push("");
  md.push("## Transitions");
  md.push("");
  for (const t of fix.transitions ?? []) {
    md.push(
      `- **${t.name}** (\`${t.teamId}\`): ${Object.entries(t.path)
        .map(([y, s]) => `${y}=${s}`)
        .join(", ")}`,
    );
  }
  md.push("");
  md.push("## Prior (phase-e) tags");
  md.push("");
  md.push(`n=${prior.nGames} · ${JSON.stringify(prior.counts)} · unknowns=${prior.unknownTeamSeasonKeys.length}`);
  md.push("");
  md.push("## TUNING 2025 w1–7 tags");
  md.push("");
  md.push(`n=${tuning.nGames} · ${JSON.stringify(tuning.counts)} · unknowns=${tuning.unknownTeamSeasonKeys.length}`);
  md.push("");
  const mdText = md.join("\n");
  writeFileSync(join(FIX, "ncaaf-subdivision-retag.md"), mdText);
  writeFileSync(join(ART, "ncaaf-subdivision-retag.md"), mdText);
  writeFileSync(join(DOCS, "ncaaf-subdivision-retag.md"), mdText);

  console.log(
    JSON.stringify(
      {
        prior: prior.counts,
        tuning: tuning.counts,
        unknowns: {
          prior: prior.unknownTeamSeasonKeys.length,
          tuning: tuning.unknownTeamSeasonKeys.length,
        },
      },
      null,
      2,
    ),
  );
  return 0;
}

process.exit(main());
