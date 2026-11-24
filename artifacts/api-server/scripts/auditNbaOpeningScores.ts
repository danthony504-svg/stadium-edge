import { resolveNbaOpeningScore, type NbaOpeningSummary } from "../src/lib/nbaOpeningScore.ts";

const eventIds = process.argv.slice(2);
if (!eventIds.length || eventIds.some((id) => !/^\d+$/.test(id))) {
  throw new Error("Pass one or more ESPN NBA event IDs");
}

for (const eventId of new Set(eventIds)) {
  try {
    const response = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${eventId}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) throw new Error(`ESPN HTTP ${response.status}`);
    const summary = await response.json() as NbaOpeningSummary;
    const evidence = resolveNbaOpeningScore(summary, eventId);
    console.log(JSON.stringify(evidence ?? { eventId, status: "opening_sequence_unverified" }));
    if (!evidence) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ eventId, status: "fetch_failed", detail: String(error) }));
    process.exitCode = 1;
  }
}
