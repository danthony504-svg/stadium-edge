/**
 * NFL historical prices vs qualified selections.
 *
 * Calibration (score variance, win Brier, tails) lives in
 * nfl-historical-calibration-report.json and is not market value.
 * This script does not invent prices and does not label calibration as CLV.
 *
 * Authorized source: The Odds API historical odds, sport key americanfootball_nfl,
 * same ODDS_API_KEY used for the NCAAF archive on PR 737. ESPN completed
 * scoreboard odds are checked and are not a close.
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

async function espnOddsEmpty(): Promise<string> {
  const url =
    "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=1&dates=2024";
  try {
    const res = await fetch(url);
    if (!res.ok) return `http ${res.status}`;
    const body = (await res.json()) as {
      events?: Array<{ competitions?: Array<{ odds?: unknown[] | null }> }>;
    };
    const events = body.events ?? [];
    const withOdds = events.filter((event) =>
      (event.competitions ?? []).some((c) => Array.isArray(c.odds) && c.odds.length > 0),
    );
    return withOdds.length === 0
      ? `empty on ${events.length} events`
      : `present on ${withOdds.length} of ${events.length}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

async function main(): Promise<number> {
  const keySet = Boolean(process.env.ODDS_API_KEY?.trim());
  const espn = await espnOddsEmpty();
  const report = {
    generatedAt: new Date().toISOString(),
    calibrationReport: "artifacts/api-server/test/fixtures/nfl-historical-calibration-report.json",
    calibrationIsNotMarketValue: true,
    qualifiedSelectionsVsClose: {
      status: keySet ? "KEY_PRESENT_NOT_FETCHED" : "NOT_MEASURED",
      reason: keySet
        ? "ODDS_API_KEY is set in this process. This run does not spend historical quota unless NFL_FETCH_CLOSING_LINES=1."
        : "ODDS_API_KEY is unset. Injected secret names do not include it. No NFL closing fixture exists on this branch or on cursor/odds-api-access-5cb3.",
      nSelections: 0,
      meanClv: null,
    },
    authorizedSources: {
      oddsApiKey: keySet ? "set" : "unset",
      oddsApiSport: "americanfootball_nfl",
      oddsApiHistoricalPath: "/v4/historical/sports/americanfootball_nfl/odds",
      injectedSecretNames: process.env.CLOUD_AGENT_INJECTED_SECRET_NAMES ?? "",
      espnCompletedScoreboardOdds: espn,
      ncaafArchiveBranch: "cursor/odds-api-access-5cb3",
      ncaafArchiveCommit: "7fbf065a607899c49d2e5aa1d636160b74ca0eb4",
    },
  };
  const out = join(here, "../test/fixtures/nfl-historical-closing-prices-report.json");
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${out}`);
  return keySet ? 0 : 2;
}

process.exit(await main());
