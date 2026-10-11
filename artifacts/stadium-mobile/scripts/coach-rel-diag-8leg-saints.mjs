/**
 * Temporary diagnostic harness: simulate the reliability reporter outcome for
 * production ask "8 leg Saints" with the live Kyler Murray Pass TDs prop.
 *
 * Does NOT change Coach selection. Does NOT publish OTA.
 */
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PROD_DOMAIN = process.env.EXPO_PUBLIC_DOMAIN || "stadium-edge.onrender.com";
const PROD_API = `https://${PROD_DOMAIN}/api`;
const ASK = "8 leg Saints";

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function titleCaseMarket(key) {
  if (key === "player_pass_tds") return "Pass TDs";
  return String(key || "")
    .replace(/^player_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function loadKylerSaintsPick() {
  const odds = await fetchJson(`${PROD_API}/sports/odds?sport=nfl`);
  const games = Array.isArray(odds) ? odds : odds.games || [];
  const g = games.find(
    (x) =>
      /saints/i.test(String(x.homeTeam || "")) &&
      /vikings/i.test(String(x.awayTeam || "")),
  );
  if (!g) throw new Error("Vikings @ Saints not on NFL odds slate");

  const espn = await fetchJson(`${PROD_API}/sports/games?sport=nfl`);
  const espnList = Array.isArray(espn) ? espn : espn.games || [];
  const eg = espnList.find(
    (x) =>
      /saints/i.test(String(x.homeTeam || "")) &&
      /vikings/i.test(String(x.awayTeam || "")),
  );
  const homeTeamId = eg?.homeTeamId ?? "18";
  const awayTeamId = eg?.awayTeamId ?? "16";
  const homeAbbr = eg?.homeAbbr ?? "NO";
  const awayAbbr = eg?.awayAbbr ?? "MIN";

  const propsRes = await fetchJson(
    `${PROD_API}/sports/props?sport=nfl&eventId=${encodeURIComponent(g.id)}` +
      `&home=${encodeURIComponent(g.homeTeam)}&away=${encodeURIComponent(g.awayTeam)}` +
      `&homeTeamId=${encodeURIComponent(homeTeamId)}&awayTeamId=${encodeURIComponent(awayTeamId)}`,
  );
  const props = propsRes.props || [];
  const kylerTd = props.find(
    (p) =>
      p.player === "Kyler Murray" &&
      p.market === "player_pass_tds" &&
      p.line === 1.5 &&
      p.underPrice != null,
  );
  if (!kylerTd) throw new Error("Kyler Murray Under 1.5 Pass TDs not on props feed");

  const teamMeta = new Map([
    [String(homeTeamId), homeAbbr],
    [String(awayTeamId), awayAbbr],
  ]);
  const teamAbbr = kylerTd.playerTeamId
    ? (teamMeta.get(String(kylerTd.playerTeamId)) ?? null)
    : null;

  return {
    ask: ASK,
    eventId: g.id,
    game: `${g.awayTeam} @ ${g.homeTeam}`,
    pick: {
      player: kylerTd.player,
      teamAbbr,
      game: `${g.awayTeam} @ ${g.homeTeam}`,
      market: titleCaseMarket(kylerTd.market),
      propMarketKey: kylerTd.market,
      propLine: kylerTd.line,
      propSide: "Under",
      isProp: true,
      athleteId: kylerTd.athleteId ?? null,
      eventId: g.id,
      playerTeamId: kylerTd.playerTeamId ?? null,
    },
  };
}

async function main() {
  const loaded = await loadKylerSaintsPick();
  const requestId = `greenfield-${Date.now()}`;
  const correlationId = `crdiag-${Date.now()}-saints8`;

  const localHits = [];
  const localServer = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/api/reliability/coach-events") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      // Defer parse to after TS modules load — stash raw first.
      localHits.push({ raw: body, at: Date.now() });
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          accepted: true,
          deduped: false,
          alerted: false,
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => localServer.listen(0, "127.0.0.1", r));
  const { port } = localServer.address();

  // Must set BEFORE importing reporter (API_BASE captured at module load).
  process.env.EXPO_PUBLIC_DOMAIN = `127.0.0.1:${port}`;
  process.env.EXPO_PUBLIC_CRASH_REPORTING = "1";
  delete process.env.CRASH_REPORTING_DISABLED;

  const reporterUrl = pathToFileURL(
    join(ROOT, "lib/coachReliabilityReporter.ts"),
  ).href;
  const groundingUrl = pathToFileURL(
    join(ROOT, "lib/coachReliabilityGrounding.ts"),
  ).href;
  const ingestUrl = pathToFileURL(
    join(ROOT, "../api-server/src/lib/coachReliabilityIngest.ts"),
  ).href;
  const sanitizeUrl = pathToFileURL(
    join(ROOT, "../api-server/src/lib/coachReliabilitySanitize.ts"),
  ).href;

  const { buildCoachReliabilityBody, reportCoachScanReliability } = await import(
    reporterUrl
  );
  const { pickHasPlayerGameGroundingMismatch } = await import(groundingUrl);
  const { parseCoachReliabilityIngestBody } = await import(ingestUrl);
  const { shouldAlertCoachEvent, failureCategoryFor } = await import(sanitizeUrl);

  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url).replace(
      `https://127.0.0.1:${port}`,
      `http://127.0.0.1:${port}`,
    );
    return origFetch(u, init);
  };

  const clientLogs = [];
  const prevInfo = console.info;
  console.info = (...args) => {
    clientLogs.push(args);
    prevInfo(...args);
  };

  const scenarios = [
    { name: "full_8_of_8", requested: 8, returned: 8 },
    { name: "underfill_5_of_8", requested: 8, returned: 5 },
  ];
  const results = [];

  for (const sc of scenarios) {
    clientLogs.length = 0;
    localHits.length = 0;
    const corr = `${correlationId}-${sc.name}`;
    const picks = Array.from({ length: sc.returned }, (_, i) =>
      i === 0
        ? loaded.pick
        : {
            game: loaded.game,
            market: "Spread",
            isProp: false,
            teamAbbr: "NO",
          },
    );
    const body = buildCoachReliabilityBody({
      requestId,
      correlationId: corr,
      sportCategory: "nfl",
      requestedLegCount: sc.requested,
      returnedLegCount: sc.returned,
      realOddsAvailable: true,
      picks,
    });
    const mismatch = pickHasPlayerGameGroundingMismatch(loaded.pick);

    reportCoachScanReliability({
      requestId,
      correlationId: corr,
      sportCategory: "nfl",
      requestedLegCount: sc.requested,
      returnedLegCount: sc.returned,
      realOddsAvailable: true,
      picks,
    });
    await new Promise((r) => setTimeout(r, 120));

    const postLog = clientLogs.find(
      (a) => String(a[0]).includes("[coach-rel-diag]") && String(a[1]) === "post",
    );
    const callLog = clientLogs.find(
      (a) => String(a[0]).includes("[coach-rel-diag]") && String(a[1]) === "call",
    );

    let serverClass = null;
    if (body) {
      const parsed = parseCoachReliabilityIngestBody(body);
      if (parsed) {
        const meta = {
          eventType: parsed.eventType,
          sportCategory: parsed.sportCategory ?? "unspecified",
          questionKind: parsed.questionKind ?? "parlay_build",
          requestedLegCount: parsed.requestedLegCount ?? null,
          returnedLegCount: parsed.returnedLegCount ?? null,
          durationMs: parsed.durationMs ?? null,
          failureReason: parsed.failureReason ?? "unknown",
          failureCategory:
            parsed.failureCategory ??
            failureCategoryFor(parsed.eventType, parsed.failureReason ?? "unknown"),
          realOddsAvailable: parsed.realOddsAvailable ?? null,
          qualificationFiltersEliminated:
            parsed.qualificationFiltersEliminated ?? null,
          answered: parsed.answered ?? null,
          requestId: parsed.requestId ?? null,
          affectedGame: parsed.affectedGame ?? null,
          rootCause: parsed.rootCause ?? null,
        };
        serverClass = {
          correlationId: parsed.correlationId ?? null,
          requestId: parsed.requestId ?? null,
          eventType: meta.eventType,
          failureReason: meta.failureReason,
          failureCategory: meta.failureCategory,
          affectedGame: meta.affectedGame,
          telegramEligible: shouldAlertCoachEvent(meta),
          dedupeSuppressed: false,
        };
      }
    }

    const hit = localHits[0];
    results.push({
      scenario: sc.name,
      reporterFired: !!callLog,
      clientCall: callLog?.[2] ?? null,
      clientPost: postLog?.[2] ?? null,
      httpStatus: postLog?.[2]?.httpStatus ?? null,
      clientBody: body,
      localPostReceived: hit?.raw
        ? {
            correlationId: hit.raw.correlationId ?? null,
            requestId: hit.raw.requestId ?? null,
            eventType: hit.raw.eventType ?? null,
            failureReason: hit.raw.failureReason ?? null,
          }
        : null,
      serverClassification: serverClass,
      kylerGroundingMismatch: mismatch,
    });
  }

  console.info = prevInfo;
  globalThis.fetch = origFetch;
  localServer.close();

  console.log(
    JSON.stringify(
      {
        ask: ASK,
        requestId,
        correlationIdBase: correlationId,
        kylerLive: loaded.pick,
        results,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
