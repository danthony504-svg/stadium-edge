/**
 * ScoreTape Explorer ($0) timestamp provenance verification from available
 * samples — docs REST/webhook examples + live /health. No API key call for
 * CFB rows (AUTH_MISSING without key). Does not purchase or activate.
 */

export const SCORETAPE_SETUP = {
  plan: "Explorer",
  costUsd: 0,
  historyDays: 7,
  rateLimit: "1 req/s",
  baseUrl: "https://api.scoretape.com/v1",
  authHeader: "X-API-Key: st_…",
  authAlt: "Authorization: Bearer st_…",
  keyRequest: "Request free API key via ScoreTape (same-day email; shown once)",
  envName: "SCORETAPE_API_KEY",
  cfbInjuriesPath: "/v1/cfb/injuries?since=<YYYY-MM-DD>",
  asOfRule: "latest row per athlete with captured_ms ≤ T (or captured ISO)",
  purchaseAuthorized: false,
} as const;

/** Published docs sample (NBA injuries REST) — schema/timing shape only. */
export const SCORETAPE_DOCS_REST_SAMPLE = {
  league: "basketball/nba",
  team: "Oklahoma City Thunder",
  athlete_id: "530853",
  athlete_name: "Jalen Williams",
  status: "Out",
  report_date: "2026-05-29T22:22Z",
  captured: "2026-06-12T08:25:22.902Z",
  source: "scoretape.com/docs REST example",
} as const;

/** Published docs webhook sample — proves captured_ms epoch ms. */
export const SCORETAPE_DOCS_WEBHOOK_SAMPLE = {
  captured_ms: 1781252722902,
  report_date: "2026-05-29T22:22Z",
  source: "scoretape.com/docs injury.status_change webhook example",
} as const;

export type ScoreTapeProvenanceReport = {
  verifiedAt: string;
  paidHttp: 0;
  keyPresent: boolean;
  health: {
    ok: boolean;
    httpStatus: number | null;
    clickhouse: boolean | null;
    detail: string;
  };
  docsSamples: {
    restCapturedParseable: boolean;
    webhookCapturedMsParseable: boolean;
    webhookCapturedIso: string | null;
    asOfRuleDocumented: true;
    cfbListedInCoverage: true;
    note: string;
  };
  espnLocalFixture: {
    path: string;
    captureTimestampParseable: boolean;
    captureTimestamp: string | null;
    preKickJoinDemoOk: boolean;
  };
  cfbLiveRowsVerified: false | true;
  blockersBeforePaidDesk: string[];
  accountSetupSteps: string[];
  verdict: string;
};

export function verifyScoreTapeDocsSamples(): {
  restCapturedParseable: boolean;
  webhookCapturedMsParseable: boolean;
  webhookCapturedIso: string | null;
} {
  const restOk = Number.isFinite(Date.parse(SCORETAPE_DOCS_REST_SAMPLE.captured));
  const ms = SCORETAPE_DOCS_WEBHOOK_SAMPLE.captured_ms;
  const webhookOk = Number.isFinite(ms) && ms > 0;
  const iso = webhookOk ? new Date(ms).toISOString() : null;
  return {
    restCapturedParseable: restOk,
    webhookCapturedMsParseable: webhookOk,
    webhookCapturedIso: iso,
  };
}

export function buildScoreTapeProvenanceReport(opts: {
  healthHttpStatus: number | null;
  healthBody?: { data?: { clickhouse?: boolean; status?: string } } | null;
  keyPresent: boolean;
  espnCaptureTimestamp: string | null;
}): ScoreTapeProvenanceReport {
  const docs = verifyScoreTapeDocsSamples();
  const healthOk = opts.healthHttpStatus === 200;
  const clickhouse = opts.healthBody?.data?.clickhouse ?? null;
  const espnTs = opts.espnCaptureTimestamp;
  const espnParseable = espnTs != null && Number.isFinite(Date.parse(espnTs));
  let preKickOk = false;
  if (espnParseable && espnTs) {
    const cap = Date.parse(espnTs);
    const kick = Date.parse("2026-10-16T23:00:00Z");
    preKickOk = cap < kick;
  }

  return {
    verifiedAt: new Date().toISOString(),
    paidHttp: 0,
    keyPresent: opts.keyPresent,
    health: {
      ok: healthOk,
      httpStatus: opts.healthHttpStatus,
      clickhouse,
      detail: healthOk
        ? "GET /v1/health 200 without key"
        : `health status ${opts.healthHttpStatus}`,
    },
    docsSamples: {
      ...docs,
      asOfRuleDocumented: true,
      cfbListedInCoverage: true,
      note:
        "Docs prove captured / captured_ms schema + as-of rule; published sample is NBA not CFB. CFB live rows require Explorer key.",
    },
    espnLocalFixture: {
      path: "test/fixtures/ncaaf-pregame-injury-snapshots/espn-cfb-injuries-2026-10-16T20-06-40-154Z.json",
      captureTimestampParseable: espnParseable,
      captureTimestamp: espnTs,
      preKickJoinDemoOk: preKickOk,
    },
    cfbLiveRowsVerified: false,
    blockersBeforePaidDesk: [
      "No SCORETAPE_API_KEY in this environment — CFB /v1/cfb/injuries not queried",
      "Must confirm CFB rows with finite captured_ms under Explorer before any Desk purchase",
      "Explorer 7-day window cannot reach 2025 FINAL_EVAL kickoffs — historical Desk depth unproven until sample earliest captured_ms checked",
    ],
    accountSetupSteps: [
      "Human: request Explorer ($0) key at scoretape.com (st_… shown once)",
      `Store as Cursor/Render secret ${SCORETAPE_SETUP.envName} — never paste into chat`,
      "Authorized later agent: GET /v1/cfb/injuries?since=<today-6d> with key",
      "Assert non-empty data[].captured or captured_ms; reconstruct as-of kickoff−1h for one FBS game",
      "Record earliest captured_ms in window → decide Desk depth (still not purchase here)",
    ],
    verdict: healthOk && docs.restCapturedParseable && docs.webhookCapturedMsParseable
      ? "SCHEMA_AND_HEALTH_OK — CFB_ROWS_PENDING_EXPLORER_KEY"
      : "PROVENANCE_INCOMPLETE",
  };
}
