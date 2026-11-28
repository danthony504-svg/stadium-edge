// Run from the mobile package with EXPO_PUBLIC_DOMAIN set, using test/register-hooks.mjs.
import { writeFile } from "node:fs/promises";
import { buildCoachParlay } from "../lib/coach/buildParlay.ts";
import { readCoachTimingBoards } from "../lib/coachTimingBoardStore.ts";

const host = process.env.EXPO_PUBLIC_DOMAIN;
if (!host || !/^[a-z0-9.-]+$/i.test(host)) throw new Error("Set EXPO_PUBLIC_DOMAIN to the API hostname");
const liveFetch = globalThis.fetch;
const requests = {};
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  if (url.hostname !== host ||
      (method !== "GET" && !url.pathname.startsWith("/api/sports/simulate/"))) {
    return new Response(null, { status: 204 });
  }
  const response = await liveFetch(input, init);
  const key = `${url.pathname} ${response.status}`;
  requests[key] = (requests[key] ?? 0) + 1;
  return response;
};

const start = performance.now();
const result = await buildCoachParlay({
  requestedLegs: 15, askText: "15 leg NBA NFL NHL", signal: AbortSignal.timeout(40_000),
});
const wallMs = Math.round(performance.now() - start);
const archive = await readCoachTimingBoards();
const snapshot = archive ? JSON.parse(archive)[0] : null;
console.log("PROBE_RESULT", JSON.stringify({
  wallMs, legs: result.picks.length, note: result.note,
  timing: snapshot?.timing ?? result.timing, boardState: snapshot?.boardState,
  games: snapshot?.board?.oddsGames?.length, props: snapshot?.board?.propPool?.length, requests,
}));
if (process.argv[2] && archive) await writeFile(process.argv[2], archive);
