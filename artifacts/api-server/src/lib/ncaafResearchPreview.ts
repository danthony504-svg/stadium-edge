/** Read-only display of frozen research forecasts. Never calls a provider or simulator. */
import { createHash } from "node:crypto";
import { canonicalEvidenceJson } from "./ncaafOvertimeTransfer.js";
import { scoreRecordedForecast } from "./ncaafForecastJournal.js";

const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const digest = (v: unknown) => hash(JSON.stringify(v));
const validTime = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const probability = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
export type PreviewRow = { key: string; value: any; settlement?: any };

function names(record: any, live: any) {
  const t = record.target,
    fallback = { home: `ESPN team ${t.homeId}`, away: `ESPN team ${t.awayId}` };
  if (!live || digest(live) !== record.input?.liveSourceEvidence?.sha256)
    return fallback;
  try {
    for (const b of live.scoreboards ?? []) {
      if (hash(b.rawResponse) !== b.sha256) continue;
      const board = JSON.parse(b.rawResponse);
      for (const e of board.events ?? []) {
        if (e.id !== t.eventId || e.season?.year !== t.season) continue;
        for (const c of e.competitions ?? []) {
          const h = c.competitors?.filter((s: any) => s.homeAway === "home"),
            a = c.competitors?.filter((s: any) => s.homeAway === "away");
          if (
            h?.length === 1 &&
            a?.length === 1 &&
            h[0].team?.id === t.homeId &&
            a[0].team?.id === t.awayId &&
            Date.parse(c.date) === Date.parse(t.kickoff)
          ) {
            return {
              home: String(h[0].team.displayName ?? fallback.home).slice(
                0,
                120,
              ),
              away: String(a[0].team.displayName ?? fallback.away).slice(
                0,
                120,
              ),
            };
          }
        }
      }
    }
  } catch {
    /* Missing source names must not become invented identities. */
  }
  return fallback;
}
function verifiedOutcome(
  record: any,
  settlement: any,
  key: string,
  now: string,
) {
  try {
    const s = settlement,
      o = s?.outcome,
      source = s?.source,
      t = record.target;
    if (
      s?.forecastKey !== key ||
      s.forecastSha256 !== digest(record) ||
      !source ||
      hash(source.rawResponse) !== source.sha256 ||
      !validTime(source.receivedAt) ||
      Date.parse(source.receivedAt) > Date.parse(now) ||
      Date.parse(source.receivedAt) < Date.parse(t.kickoff)
    )
      return null;
    const raw = JSON.parse(source.rawResponse),
      header = raw.header;
    if (header?.id !== t.eventId || header.season?.year !== t.season)
      return null;
    const competitions = header.competitions?.filter(
      (c: any) =>
        c.status?.type?.completed === true &&
        Date.parse(c.date) === Date.parse(t.kickoff),
    );
    if (competitions?.length !== 1) return null;
    const c = competitions[0],
      h = c.competitors?.filter((x: any) => x.homeAway === "home"),
      a = c.competitors?.filter((x: any) => x.homeAway === "away");
    if (
      h?.length !== 1 ||
      a?.length !== 1 ||
      h[0].team?.id !== t.homeId ||
      a[0].team?.id !== t.awayId ||
      Number(h[0].score) !== o.homePoints ||
      Number(a[0].score) !== o.awayPoints
    )
      return null;
    const metrics = scoreRecordedForecast(record, o);
    return {
      homePoints: o.homePoints,
      awayPoints: o.awayPoints,
      observedAt: source.receivedAt,
      metrics,
    };
  } catch {
    return null;
  }
}
export function buildNcaafResearchPreview(
  rows: PreviewRow[],
  liveSources: Map<string, any>,
  now: string,
) {
  if (!validTime(now)) throw Error("preview_invalid_clock");
  let withheld = 0,
    unsupportedLegacyRecords = 0,
    unverifiedOutcomes = 0;
  const games = rows.flatMap(({ key, value: r, settlement }) => {
    try {
      const t = r?.target;
      if (r?.inputHashFormat !== "canonical-json-sha256-v1") {
        unsupportedLegacyRecords++;
        return [];
      }
      if (
        !/^research:ncaaf:forecast:/.test(key) ||
        r.researchOnly !== true ||
        r.productionReady !== false ||
        ![
          "ncaaf-observed-ot-research-v1",
          "ncaaf-observed-ot-transfer-research-v2",
        ].includes(r.modelVersion) ||
        r.simulations !== 10000 ||
        !t ||
        !/^\d+$/.test(t.eventId) ||
        !/^\d+$/.test(t.homeId) ||
        !/^\d+$/.test(t.awayId) ||
        t.homeId === t.awayId ||
        !Number.isSafeInteger(t.season) ||
        ![r.recordedAt, r.forecastAt, r.inputCutoffAt, t.kickoff].every(
          validTime,
        ) ||
        Date.parse(r.inputCutoffAt) > Date.parse(r.forecastAt) ||
        Date.parse(r.forecastAt) > Date.parse(r.recordedAt) ||
        Date.parse(r.recordedAt) >= Date.parse(t.kickoff) ||
        Date.parse(r.recordedAt) > Date.parse(now) ||
        JSON.stringify(t) !== JSON.stringify(r.input?.target)
      )
        throw Error("preview_invalid_record");
      const inputHash = hash(canonicalEvidenceJson(r.input));
      if (
        inputHash !== r.inputSha256 ||
        !Array.isArray(r.markets) ||
        !r.markets.length ||
        r.markets.length > 512 ||
        r.markets.length !== r.input.quotes.length
      )
        throw Error("preview_invalid_hash");
      const identity = names(
        r,
        liveSources.get(r.input.liveSourceEvidence?.key),
      );
      const outcome = verifiedOutcome(r, settlement, key, now);
      if (settlement && !outcome) unverifiedOutcomes++;
      const rawMarkets: any[] = r.markets;
      const markets = rawMarkets.map((q: any, i: number) => {
        const original = r.input.quotes[i];
        if (
          !["ml", "spread", "total"].includes(q.market) ||
          q.settlement !== "full_game_including_overtime" ||
          q.eventId !== t.eventId ||
          q.season !== t.season ||
          typeof q.bookmaker !== "string" ||
          !q.bookmaker.trim() ||
          ![q.firstPrice, q.secondPrice].every(
            (p) =>
              typeof p === "number" && Number.isFinite(p) && Math.abs(p) >= 100,
          ) ||
          (q.market === "ml" ? q.line !== null : !Number.isFinite(q.line)) ||
          ![
            "season",
            "eventId",
            "bookmaker",
            "market",
            "line",
            "firstPrice",
            "secondPrice",
            "observedAt",
            "settlement",
          ].every((k) => q[k] === original[k]) ||
          !validTime(q.observedAt) ||
          Date.parse(q.observedAt) > Date.parse(r.forecastAt) ||
          !probability(q.winProbability) ||
          !probability(q.pushProbability) ||
          q.winProbability + q.pushProbability > 1 + 1e-9 ||
          (q.conditionalWinProbability !== null &&
            !probability(q.conditionalWinProbability)) ||
          (q.pushProbability < 1 &&
            (q.conditionalWinProbability === null ||
              Math.abs(
                q.conditionalWinProbability -
                  q.winProbability / (1 - q.pushProbability),
              ) > 1e-9))
        )
          throw Error("preview_invalid_market");
        const implied = (p: number) =>
          p < 0 ? -p / (-p + 100) : 100 / (p + 100);
        const a = implied(q.firstPrice),
          b = implied(q.secondPrice);
        return {
          bookmaker: q.bookmaker.slice(0, 100),
          market: q.market as "ml" | "spread" | "total",
          line: q.line as number | null,
          firstPrice: q.firstPrice as number,
          secondPrice: q.secondPrice as number,
          observedAt: q.observedAt as string,
          winProbability: q.winProbability as number,
          pushProbability: q.pushProbability as number,
          conditionalWinProbability: q.conditionalWinProbability as
            | number
            | null,
          marketProbability: a / (a + b),
          result: outcome?.metrics[i]?.result ?? "pending",
        };
      });
      return [
        {
          eventId: t.eventId as string,
          season: t.season as number,
          ...identity,
          kickoff: t.kickoff as string,
          forecastAt: r.forecastAt as string,
          recordedAt: r.recordedAt as string,
          modelVersion: String(r.modelVersion).slice(0, 120),
          inputSha256: inputHash,
          status: outcome
            ? "final"
            : Date.parse(t.kickoff) <= Date.parse(now)
              ? "awaiting_verified_final"
              : "pregame",
          outcome: outcome
            ? {
                homePoints: outcome.homePoints,
                awayPoints: outcome.awayPoints,
                observedAt: outcome.observedAt,
              }
            : null,
          markets,
        },
      ];
    } catch {
      withheld++;
      return [];
    }
  });
  games.sort(
    (a, b) =>
      Date.parse(a.kickoff) - Date.parse(b.kickoff) ||
      a.eventId.localeCompare(b.eventId) ||
      a.modelVersion.localeCompare(b.modelVersion),
  );
  return {
    generatedAt: now,
    researchOnly: true,
    validationReady: false,
    coachEnabled: false,
    label: "UNVALIDATED RESEARCH PREVIEW",
    limitations:
      "Saved experimental forecasts, not approved Coach picks. Injury, opponent-strength and venue adjustments are not fitted. Overtime transfer is unverified. Captured odds are historical, not current offers. Pushes are separate; probabilities are conditional on no push. Quote counts and development games do not establish independent holdout qualification.",
    distinctGames: new Set(games.map((g) => `${g.season}:${g.eventId}`)).size,
    settledGames: new Set(
      games
        .filter((g) => g.status === "final")
        .map((g) => `${g.season}:${g.eventId}`),
    ).size,
    withheld,
    unsupportedLegacyRecords,
    unverifiedOutcomes,
    games,
  };
}
export type ResearchPreview = ReturnType<typeof buildNcaafResearchPreview>;
export const escapeHtml = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const pct = (n: number | null) =>
  n === null ? "Unknown" : `${(n * 100).toFixed(1)}%`;
const price = (n: number) => (n > 0 ? `+${n}` : String(n));
const when = (s: string) =>
  new Date(s).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
export function renderNcaafResearchPreview(p: ResearchPreview) {
  const e = escapeHtml;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NCAAF Research · Stadium Edge</title><style>body{margin:0;background:#0f1729;color:#eef3fc;font:16px system-ui,sans-serif}main{max-width:1000px;margin:auto;padding:24px 16px}h1{font-size:28px;margin:12px 0}h2{font-size:21px}a{color:#78b7ff}nav{display:flex;gap:20px;margin:20px 0}.badge{display:inline-block;color:#ffda83;border:1px solid #a77821;border-radius:8px;padding:6px 10px;font-weight:700;font-size:13px}.notice,article{padding:18px;border:1px solid #34415c;border-radius:16px;margin:16px 0}.notice{background:#202b40}p{line-height:1.5}.muted,small{color:#b0bed3}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:12px 8px;border-bottom:1px solid #34415c;min-width:95px}summary{cursor:pointer;padding:12px 0;color:#78b7ff}code{overflow-wrap:anywhere;font-size:12px}.stats{font-size:18px}footer{margin:30px 0}a:focus,summary:focus{outline:2px solid #78b7ff}</style></head><body><main><small>STADIUM EDGE</small><h1>NCAAF research preview</h1><span class="badge">${e(p.label)}</span><div class="notice"><p>${e(p.limitations)}</p><p><strong>Subscriber NCAAF Coach remains locked.</strong> These are frozen research probabilities, not recommended tickets. No confidence grade or quality approval is implied.</p></div><nav><a href="/api/research/ncaaf">Refresh results</a><a href="/api/research/ncaaf/download">Download report</a><a href="/api/research/ncaaf/status">Pipeline status</a></nav><p class="stats">${p.distinctGames} distinct games · ${p.settledGames} verified finals</p><p class="muted">Updated ${e(when(p.generatedAt))}. Refresh to load the latest stored results (up to 60 seconds of caching). All times Central. Up to 64 most recently recorded forecasts are displayed.</p>${p.withheld || p.unverifiedOutcomes || p.unsupportedLegacyRecords ? `<p class="notice">${p.unsupportedLegacyRecords} legacy forecasts omitted because their original serialization cannot be authenticated after database storage; ${p.withheld} forecasts withheld for invalid evidence; ${p.unverifiedOutcomes} final results could not be verified.</p>` : ""}${p.games.length ? p.games.map((g) => `<article><h2>${e(g.away)} @ ${e(g.home)}</h2><p>${e(when(g.kickoff))} · ${g.status === "final" ? `Verified final: ${e(g.away)} ${g.outcome!.awayPoints} — ${e(g.home)} ${g.outcome!.homePoints}` : g.status === "pregame" ? "Pregame" : "Awaiting verified final (not a live scoreboard)"}</p><p class="muted">Forecast frozen ${e(when(g.forecastAt))} · 10,000 simulations</p><details><summary>View ${g.markets.length} captured market pairs and results</summary><p>Moneyline/spread: first side is <strong>${e(g.home)}</strong>; second is ${e(g.away)}. Spread is the home line. Total: first side is Over; second is Under. Win/loss labels below apply to the first side. All markets include overtime. Pushes are excluded from conditional win probability.</p><div class="scroll"><table><thead><tr><th>Book / market</th><th>Line</th><th>Captured odds<br>First / second</th><th>Model first side<br>No push</th><th>Market baseline<br>No vig</th><th>Push chance</th><th>First-side result</th></tr></thead><tbody>${g.markets.map((q) => `<tr><td>${e(q.bookmaker)}<br>${e(q.market === "ml" ? "Moneyline" : q.market === "spread" ? "Home spread" : "Total (Over)")}<br><small>${e(when(q.observedAt))}</small></td><td>${q.line === null ? "—" : e(q.line)}</td><td>${price(q.firstPrice)} / ${price(q.secondPrice)}</td><td>${pct(q.conditionalWinProbability)}</td><td>${pct(q.marketProbability)}</td><td>${pct(q.pushProbability)}</td><td>${e(q.result)}</td></tr>`).join("")}</tbody></table></div><p><small>Model: ${e(g.modelVersion)}<br>Event: ${e(g.eventId)} · Season: ${g.season}<br>Input SHA-256: <code>${e(g.inputSha256)}</code></small></p></details></article>`).join("") : `<p>No verified saved forecasts are available to display.</p>`}<footer><p class="muted">The 500-game/two-season acceptance requirement and independent review remain in place. A displayed final is not proof of model validation. This page reads saved records and never generates or changes forecasts.</p></footer></main></body></html>`;
}
