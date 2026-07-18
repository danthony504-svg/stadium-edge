import { Router, type IRouter } from "express";
import { rateLimit } from "../lib/sports";
import {
  fetchStealsWithMeta,
  persistSteals,
  gradePending,
  getRecord,
  getGradedHistory,
  type StealRecord,
} from "../lib/liveSteals";
import { seasonStatsFromGraded } from "../lib/liveStealsCore";
import {
  emptyStealFeedDiagnostics,
  StealFeedScanError,
  type StealFeedDiagnostics,
} from "../lib/stealFeedDiagnostics";

// GET /api/sports/live-steals — the mobile "+500 Steals" feed: live/upcoming
// longshot bets (American odds +500..+30000) carrying a REAL cross-book no-vig
// edge, plus the auto-graded W/L track record of the app's OWN steal picks.
const router: IRouter = Router();

router.use("/sports/live-steals", rateLimit({ windowMs: 60_000, max: 60, name: "live-steals" }));

let lastGradeAt = 0;
const GRADE_THROTTLE_MS = 5 * 60 * 1000;

const EMPTY_SCAN_META = {
  booksScanned: 0,
  marketsChecked: 0,
  longshotsAnalyzed: 0,
  stealsFound: 0,
  sportCounts: {} as Record<string, number>,
  totalOpportunities: 0,
  scanComplete: false,
};

const EMPTY_RECORD: StealRecord = {
  wins: 0,
  losses: 0,
  pushes: 0,
  pending: 0,
  ungraded: 0,
  graded: 0,
};

async function loadLedger(): Promise<{
  record: StealRecord;
  history: Awaited<ReturnType<typeof getGradedHistory>>;
  seasonStats: ReturnType<typeof seasonStatsFromGraded>;
  ledgerError: string | null;
}> {
  try {
    const [record, history] = await Promise.all([getRecord(), getGradedHistory()]);
    return {
      record,
      history,
      seasonStats: seasonStatsFromGraded(history),
      ledgerError: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    if (stack) console.error(`[live-steals] ledger load failed:\n${stack}`);
    return {
      record: EMPTY_RECORD,
      history: [],
      seasonStats: { roiPct: null, avgOdds: null },
      ledgerError: message,
    };
  }
}

function feedStatusFromDiagnostics(
  feed: StealFeedDiagnostics,
  httpStatus: number,
): StealFeedDiagnostics & { httpStatus: number; ok: boolean } {
  return {
    ...feed,
    httpStatus,
    ok: feed.errorReason == null,
  };
}

function scanErrorPayload(err: unknown, routeStarted: number): {
  feed: StealFeedDiagnostics;
  scanError: {
    message: string;
    failedStage: string | null;
    scanStages: StealFeedDiagnostics["scanStages"];
  };
} {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  const feed: StealFeedDiagnostics =
    err instanceof StealFeedScanError
      ? err.diagnostics
      : emptyStealFeedDiagnostics({
          responseTimeMs: Date.now() - routeStarted,
          errorReason: message,
        });

  return {
    feed: {
      ...feed,
      errorReason: feed.errorReason ?? message,
      responseTimeMs: Date.now() - routeStarted,
    },
    scanError: {
      message,
      failedStage:
        feed.failedStage ?? (err instanceof StealFeedScanError ? err.failedStage ?? null : null),
      scanStages: feed.scanStages ?? [],
    },
  };
}

router.get("/sports/live-steals", async (req, res): Promise<void> => {
  const routeStarted = Date.now();
  const ledger = await loadLedger();

  try {
    const scan = await fetchStealsWithMeta();
    await persistSteals(scan.steals).catch((err) => {
      const stack = err instanceof Error ? err.stack : undefined;
      req.log.warn({ err, stack }, "live-steals persist failed — continuing with scan results");
    });

    if (Date.now() - lastGradeAt > GRADE_THROTTLE_MS) {
      lastGradeAt = Date.now();
      gradePending().catch((err) => {
        const stack = err instanceof Error ? err.stack : undefined;
        req.log.warn({ err, stack }, "live-steals gradePending failed");
      });
    }

    const feed = feedStatusFromDiagnostics(scan.feed, 200);
    req.log.info(
      {
        feedOk: feed.ok,
        responseTimeMs: Date.now() - routeStarted,
        sportsOk: feed.sportsOk,
        sportsFailed: feed.sportsFailed,
        marketsChecked: scan.meta.marketsChecked,
        stealsFound: scan.meta.stealsFound,
        ledgerError: ledger.ledgerError,
        scanStages: scan.feed.scanStages?.map((s) => ({ stage: s.stage, count: s.count, ok: s.ok })),
      },
      "live-steals scan ok",
    );

    res.status(200).json({
      steals: scan.steals,
      record: ledger.record,
      history: ledger.history,
      meta: scan.meta,
      almostQualified: scan.almostQualified,
      seasonStats: ledger.seasonStats,
      feedDegraded: false,
      feed,
      ledgerError: ledger.ledgerError,
    });
  } catch (err) {
    const stack = err instanceof Error ? err.stack : undefined;
    const { feed, scanError } = scanErrorPayload(err, routeStarted);

    req.log.error(
      {
        err,
        stack,
        scanError,
        feed,
        responseTimeMs: Date.now() - routeStarted,
        ledgerError: ledger.ledgerError,
      },
      "live-steals scan failed",
    );

    // Always 200 with structured diagnostics — never a bare HTTP 502 without detail.
    // Mobile client surfaces feed.errorReason + scanError.failedStage to the user.
    res.status(200).json({
      steals: [],
      almostQualified: [],
      meta: EMPTY_SCAN_META,
      record: ledger.record,
      history: ledger.history,
      seasonStats: ledger.seasonStats,
      feedDegraded: true,
      feed: feedStatusFromDiagnostics(feed, 200),
      ledgerError: ledger.ledgerError,
      scanError,
    });
  }
});

export default router;
