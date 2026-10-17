/**
 * E4 draft — pregame injury/QB snapshot collector.
 *
 * No licensed historical provider with verified pre-kickoff timestamps is
 * available in this environment (SportsDataIO timing unproven; CFBD has no
 * injury family; ESPN public injuries are current-only). ScoreTape documents
 * captured_ms as-of reconstruction but is not configured here and must not be
 * purchased from this agent.
 *
 * This collector freezes ESPN's *live* college-football injury feed with an
 * explicit capture timestamp so evidence can accumulate going forward.
 *
 * Validation cannot finish until enough snapshots exist with
 * captureTimestamp < game.kickoff for holdout-eligible games, joined to
 * injuryKnown/qbOut without coercing missing → false.
 *
 * Usage:
 *   node --import ./test/register-hooks.mjs ./scripts/ncaafPregameInjurySnapshotCollector.ts
 *
 * Does not flip NCAAF_GAME_LINE_SIM_VALIDATED.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "../test/fixtures/ncaaf-pregame-injury-snapshots");
const MANIFEST = join(OUT_DIR, "manifest.json");
const ESPN =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/injuries";

type Entry = {
  player?: string;
  status?: string;
  position?: string | null;
  athleteId?: string | null;
};

type TeamInj = { team?: string; teamId?: string | null; entries: Entry[] };

async function main(): Promise<number> {
  console.log("══ NCAAF pregame injury snapshot collector (draft) ══");
  console.log("NCAAF_GAME_LINE_SIM_VALIDATED is NOT flipped.");

  const active = ["1", "true", "yes"].includes(
    String(process.env.NCAAF_INJURY_COLLECTOR_ACTIVE ?? "")
      .trim()
      .toLowerCase(),
  );
  if (!active) {
    console.log(
      JSON.stringify(
        {
          status: "INACTIVE",
          reason:
            "NCAAF_INJURY_COLLECTOR_ACTIVE not set — prepared but not activated (Phase E)",
          prepFixture: "test/fixtures/ncaaf-forward-injury-collector-prep.json",
          hint: "Set NCAAF_INJURY_COLLECTOR_ACTIVE=1 to freeze a forward ESPN snapshot",
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const captureTimestamp = new Date().toISOString();
  const res = await fetch(ESPN, {
    headers: { "User-Agent": "stadium-edge-e4-snapshot/1.0" },
  });
  if (!res.ok) {
    console.error(`ESPN injuries HTTP ${res.status}`);
    return 2;
  }
  const raw = (await res.json()) as {
    injuries?: Array<{
      id?: string;
      displayName?: string;
      injuries?: Array<{
        athlete?: {
          id?: string | number;
          displayName?: string;
          position?: { abbreviation?: string };
        };
        status?: string;
      }>;
    }>;
  };

  const teams: TeamInj[] = (raw.injuries ?? []).map((t) => ({
    team: t.displayName ?? "Unknown",
    teamId: t.id != null ? String(t.id) : null,
    entries: (t.injuries ?? []).map((i) => ({
      player: i.athlete?.displayName ?? "Unknown",
      status: i.status ?? "Unknown",
      position: i.athlete?.position?.abbreviation ?? null,
      athleteId:
        i.athlete?.id != null && String(i.athlete.id).trim()
          ? String(i.athlete.id)
          : null,
    })),
  }));

  const qbOutish = teams.flatMap((t) =>
    t.entries.filter(
      (e) =>
        e.position === "QB" &&
        /out|doubtful|suspended/i.test(String(e.status ?? "")),
    ),
  );

  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(
    OUT_DIR,
    `espn-cfb-injuries-${captureTimestamp.replace(/[:.]/g, "-")}.json`,
  );
  const snapshot = {
    source: "espn_site_api_college_football_injuries",
    captureTimestamp,
    captureNote:
      "Wall-clock capture of the live ESPN injuries feed. Valid as pre-kickoff evidence ONLY for games with kickoffIso > captureTimestamp. Not a historical backfill.",
    teamCount: teams.length,
    qbOutOrDoubtfulCount: qbOutish.length,
    teams,
  };
  writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);

  type Manifest = {
    snapshots: Array<{
      file: string;
      captureTimestamp: string;
      teamCount: number;
      qbOutOrDoubtfulCount: number;
    }>;
    evidenceRequiredBeforeE4Validation: string[];
  };
  let manifest: Manifest = {
    snapshots: [],
    evidenceRequiredBeforeE4Validation: [
      "Multiple snapshots spanning a full FBS slate with captureTimestamp < each game's kickoffIso",
      "Join producing injuryKnown=true|null and optional qbOut — never coerce missing to false",
      "Segment conservatism: mean |edge| on injuryKnown=null ≤ mean |edge| on injuryKnown=true with documented n",
      "Competition scope remains Odds-listed FBS only",
      "Do not purchase SportsDataIO/ScoreTape solely on unverified archive timing claims",
    ],
  };
  if (existsSync(MANIFEST)) {
    manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
  }
  manifest.snapshots.push({
    file: file.split("/").pop()!,
    captureTimestamp,
    teamCount: teams.length,
    qbOutOrDoubtfulCount: qbOutish.length,
  });
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        wrote: file,
        captureTimestamp,
        teamCount: teams.length,
        qbOutOrDoubtfulCount: qbOutish.length,
        snapshotCount: manifest.snapshots.length,
        evidenceRequiredBeforeE4Validation:
          manifest.evidenceRequiredBeforeE4Validation,
      },
      null,
      2,
    ),
  );
  return 0;
}

main().then((code) => process.exit(code));
