import { cachedJson } from "./sports.js";

/** Single-day ESPN reads shared by browse, bulk odds and grading. */
export async function fetchEspnScoreboardDays<T>(
  path: string,
  days: readonly string[],
  load: (url: string) => Promise<{ events?: T[] }> = url => cachedJson(
    `espn-scoreboard-day:${url}`, 60_000, async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw Error(`ESPN scoreboard ${response.status}`);
      return await response.json() as { events?: T[] };
    }),
): Promise<T[]> {
  const unique = [...new Set(days)];
  if (unique.some(day => !/^\d{8}$/.test(day))) throw Error("invalid_espn_scoreboard_day");
  const batches: T[][] = new Array(unique.length);
  let next = 0, successes = 0;
  await Promise.all(Array.from({ length: Math.min(4, unique.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= unique.length) return;
      const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${unique[i]}&limit=300`;
      try { batches[i] = (await load(url)).events ?? []; successes++; }
      catch { batches[i] = []; }
    }
  }));
  if (unique.length && !successes) throw Error("espn_scoreboard_all_days_failed");
  // Do not dedupe tournaments here: tennis/golf events can contain different
  // daily competitions under the same tournament id. Callers dedupe games.
  return batches.flat();
}
