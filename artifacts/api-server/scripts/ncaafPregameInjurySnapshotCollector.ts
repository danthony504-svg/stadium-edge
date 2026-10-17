/**
 * E4 — pregame injury/QB snapshot collector ($0 ESPN forward freezes).
 *
 * Durable storage with minute/content dedupe + failure journal.
 * Requires NCAAF_INJURY_COLLECTOR_ACTIVE=1.
 * Does not flip product gates or mutate frozen moneyline M_base.
 *
 * Usage:
 *   NCAAF_INJURY_COLLECTOR_ACTIVE=1 node --import ./test/register-hooks.mjs \
 *     ./scripts/ncaafPregameInjurySnapshotCollector.ts
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  appendFailure,
  persistInjurySnapshot,
} from "../src/lib/sportSim/ncaafClean/injurySnapshotStore.ts";

const here = dirname(fileURLToPath(import.meta.url));
/** Durable store (not git fixtures). Override with NCAAF_INJURY_SNAPSHOT_DIR. */
const DEFAULT_OUT = join(here, "../var/ncaaf-injury-snapshots");
const OUT_DIR = process.env.NCAAF_INJURY_SNAPSHOT_DIR?.trim()
  ? process.env.NCAAF_INJURY_SNAPSHOT_DIR.trim()
  : DEFAULT_OUT;
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
  console.log("══ NCAAF pregame injury snapshot collector ══");
  console.log("NCAAF_GAME_LINE_SIM_VALIDATED is NOT flipped.");
  console.log(`storage=${OUT_DIR}`);

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
          reason: "NCAAF_INJURY_COLLECTOR_ACTIVE not set",
          outDir: OUT_DIR,
          frozenMlUnchanged: true,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const captureTimestamp = new Date().toISOString();
  let res: Response;
  try {
    res = await fetch(ESPN, {
      headers: { "User-Agent": "stadium-edge-e4-snapshot/1.0" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    appendFailure(OUT_DIR, {
      at: captureTimestamp,
      stage: "fetch",
      httpStatus: null,
      message,
      frozenMlUnchanged: true,
    });
    console.error(JSON.stringify({ status: "FAILED", stage: "fetch", message }));
    return 2;
  }

  if (!res.ok) {
    appendFailure(OUT_DIR, {
      at: captureTimestamp,
      stage: "fetch",
      httpStatus: res.status,
      message: `ESPN injuries HTTP ${res.status}`,
      frozenMlUnchanged: true,
    });
    console.error(
      JSON.stringify({
        status: "FAILED",
        stage: "fetch",
        httpStatus: res.status,
      }),
    );
    return 2;
  }

  let raw: {
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
  try {
    raw = (await res.json()) as typeof raw;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    appendFailure(OUT_DIR, {
      at: captureTimestamp,
      stage: "parse",
      httpStatus: res.status,
      message,
      frozenMlUnchanged: true,
    });
    console.error(JSON.stringify({ status: "FAILED", stage: "parse", message }));
    return 2;
  }

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

  try {
    const result = persistInjurySnapshot(OUT_DIR, {
      source: "espn_site_api_college_football_injuries",
      captureTimestamp,
      captureNote:
        "Wall-clock capture of the live ESPN injuries feed. Valid as pre-kickoff evidence ONLY for games with kickoffIso > captureTimestamp. Not a historical backfill. Never joins into frozen FINAL_EVAL M_base.",
      teamCount: teams.length,
      qbOutOrDoubtfulCount: qbOutish.length,
      teams,
    });
    console.log(JSON.stringify({ status: "OK", ...result, frozenMlUnchanged: true }, null, 2));
    return 0;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    appendFailure(OUT_DIR, {
      at: captureTimestamp,
      stage: "write",
      message,
      frozenMlUnchanged: true,
    });
    console.error(JSON.stringify({ status: "FAILED", stage: "write", message }));
    return 2;
  }
}

main().then((code) => process.exit(code));
