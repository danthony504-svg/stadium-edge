/**
 * Phase C/D — exact Odds request manifests + separate hard credit caps.
 * close-only h2h (FINAL_EVAL) and early two-sided CLV snapshots.
 * Dry-run only: dedupe vs existing archives. No paid HTTP.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildDedupeKey,
  estimateHistoricalFeaturedCredits,
  snapshotBucketIso,
} from "../src/lib/ncaafForwardCollector.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "../test/fixtures");
const DOCS = join(HERE, "../../../docs/coach");
const ART = "/opt/cursor/artifacts";

const SPORT = "americanfootball_ncaaf";
const REGION = "us";

type GameKick = { eventId: string; kickoffIso: string; season: number; week?: number | null };

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function minuteBucket(kickoffIso: string): string {
  try {
    return snapshotBucketIso(
      kickoffIso.endsWith("Z") || kickoffIso.includes("+")
        ? kickoffIso
        : kickoffIso + "Z",
    );
  } catch {
    // fall back for ESPN times like 2025-10-18T19:30Z already ok
    const s = kickoffIso.replace(/\.\d+Z$/, "Z");
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
      return s.slice(0, 16) + ":00Z";
    }
    throw new Error(`bad kickoff ${kickoffIso}`);
  }
}

function earlyBucket(kickoffIso: string): string {
  const t = Date.parse(kickoffIso.endsWith("Z") ? kickoffIso : kickoffIso + "Z");
  const early = new Date(t - 24 * 3600 * 1000);
  return snapshotBucketIso(early.toISOString());
}

function listCacheFiles(dir: string): Set<string> {
  if (!existsSync(dir)) return new Set();
  return new Set(readdirSync(dir).filter((f) => f.endsWith(".json")));
}

function existingTuningCloseBuckets(): Set<string> {
  const closes = loadJson<{
    games: Array<{ kickoffIso?: string; closeRequestDate?: string; gameId: string }>;
  }>(join(FIX, "ncaaf-tuning-2025-w1-7-closing-lines.json")).games;
  const s = new Set<string>();
  for (const c of closes) {
    const iso = c.closeRequestDate ?? c.kickoffIso;
    if (iso) s.add(minuteBucket(iso));
  }
  return s;
}

function buildManifest(opts: {
  id: string;
  purpose: string;
  markets: string[];
  mode: string;
  games: GameKick[];
  bucketFn: (iso: string) => string;
  hardCap: number;
  existingBuckets: Set<string>;
  fileCacheDir: string;
  timingNotes: string[];
  coverageLimitations: string[];
}) {
  const creditsEach = estimateHistoricalFeaturedCredits(
    opts.markets.length,
    1,
  ).creditsPerCall;

  const bucketToGames = new Map<string, string[]>();
  for (const g of opts.games) {
    const b = opts.bucketFn(g.kickoffIso);
    const arr = bucketToGames.get(b) ?? [];
    arr.push(g.eventId);
    bucketToGames.set(b, arr);
  }

  const cacheFiles = listCacheFiles(opts.fileCacheDir);
  const primaryBuckets = [...bucketToGames.keys()].sort();
  const requests = primaryBuckets.map((bucket) => {
    const dedupeKey = buildDedupeKey({
      sport: SPORT,
      mode: opts.mode,
      markets: opts.markets,
      regions: [REGION],
      snapshotBucketIso: bucket,
    });
    const inTuningArchive = opts.existingBuckets.has(bucket);
    const cacheFile = `${bucket.replace(/:/g, "-")}.json`;
    const inFileCache = cacheFiles.has(cacheFile);
    const skipHttp = inTuningArchive || inFileCache;
    return {
      bucketIso: bucket,
      eventIds: bucketToGames.get(bucket)!,
      nEvents: bucketToGames.get(bucket)!.length,
      endpoint: "GET /v4/historical/sports/americanfootball_ncaaf/odds",
      query: {
        regions: REGION,
        markets: opts.markets.join(","),
        oddsFormat: "american",
        date: bucket,
      },
      dedupeKey,
      creditsIfFetched: creditsEach,
      skipHttp,
      skipReason: inFileCache
        ? "file_cache_hit"
        : inTuningArchive
          ? "tuning_close_archive_bucket"
          : null,
    };
  });

  const toFetch = requests.filter((r) => !r.skipHttp);
  const baseCredits = toFetch.length * creditsEach;
  const retryBuffer = Math.ceil(baseCredits * 0.25);
  const proposedCap = opts.hardCap;

  return {
    id: opts.id,
    purpose: opts.purpose,
    generatedAt: new Date().toISOString(),
    paidRetrieval: false,
    mode: "dry_run_manifest_only",
    oddsApiKey: "UNSET",
    sport: SPORT,
    markets: opts.markets,
    regions: [REGION],
    nGames: opts.games.length,
    nPrimaryBuckets: primaryBuckets.length,
    nBucketsToFetch: toFetch.length,
    nBucketsSkipped: requests.length - toFetch.length,
    creditsPerBucket: creditsEach,
    creditMath: {
      formula: "10 × markets × regions",
      baseCredits,
      retryBufferCredits: retryBuffer,
      retryBufferPolicy: "25% of base for commence/previousTimestamp retries",
      hardCap: proposedCap,
      fitsInHardCap: baseCredits + retryBuffer <= proposedCap,
      note: "Hard caps are separate per manifest — do not share spend across close and early CLV without new approval",
    },
    deduplication: {
      againstTuningCloseBuckets: opts.existingBuckets.size,
      fileCacheDir: opts.fileCacheDir,
      fileCacheCount: cacheFiles.size,
      keyFormula: "sport|mode|markets|regions|snapshotBucketIso",
    },
    timingNotes: opts.timingNotes,
    coverageLimitations: opts.coverageLimitations,
    twoSided: {
      required: true,
      extract: opts.markets.includes("h2h")
        ? ["closeMlHome", "closeMlAway"]
        : [],
      neverInventAwayFromVigFree: true,
    },
    requests,
  };
}

const membershipPath = join(FIX, "ncaaf-final-eval-membership-games.json");
if (!existsSync(membershipPath)) {
  console.error(
    "Missing ncaaf-final-eval-membership-games.json — run ncaafCleanFinalEvalMembership.ts first",
  );
  process.exit(1);
}

const feGames = loadJson<{
  games: Array<{
    eventId: string;
    kickoffIso: string;
    season: number;
    week?: number | null;
  }>;
}>(membershipPath).games;

const tuningBuckets = existingTuningCloseBuckets();

/**
 * Separate caps; combined ceiling locked at 4200.
 * Equal 2100/2100 so each covers ~167 buckets × 10 + 25% retry (~2088).
 */
const CLOSE_HARD_CAP = 2100;
const EARLY_HARD_CAP = 2100;
const COMBINED_MAX_CREDITS = 4200;
if (CLOSE_HARD_CAP + EARLY_HARD_CAP !== COMBINED_MAX_CREDITS) {
  throw new Error(
    `Cap invariant broken: ${CLOSE_HARD_CAP}+${EARLY_HARD_CAP} !== ${COMBINED_MAX_CREDITS}`,
  );
}

const closeManifest = buildManifest({
  id: "FINAL_EVAL_close_h2h_only",
  purpose: "FINAL_EVAL moneyline closes (eval-only) — markets=h2h only",
  markets: ["h2h"],
  mode: "historical_close",
  games: feGames,
  bucketFn: minuteBucket,
  hardCap: CLOSE_HARD_CAP,
  existingBuckets: tuningBuckets,
  fileCacheDir: join(ART, "ncaaf-e2b-close-snapshots"),
  timingNotes: [
    "date= kickoff truncated to UTC minute",
    "API returns closest snapshot ≤ date (5-minute intervals)",
    "Reject snapshotTimestamp >= commence after retries → MISSING_DATA",
    "Midday slate snaps are not closes",
  ],
  coverageLimitations: [
    "h2h only — no spreads/totals/ALTs in this manifest",
    "Requires paid Odds historical plan; ODDS_API_KEY unset here",
    "FINAL_EVAL membership must be FBS–FBS filtered at score time",
    "Does not include early T−24h (see CLV manifest)",
    "TUNING close archive buckets skipped only when identical minute bucket overlaps (rare for FINAL_EVAL)",
  ],
});

const clvManifest = buildManifest({
  id: "FINAL_EVAL_early_t24h_h2h_twosided",
  purpose:
    "Coach CLV early two-sided ML (~T−24h) for clean E1 — markets=h2h; never invent away",
  markets: ["h2h"],
  mode: "historical_early_t24h",
  games: feGames,
  bucketFn: earlyBucket,
  hardCap: EARLY_HARD_CAP,
  existingBuckets: new Set(), // early cache empty; do not treat close buckets as early
  fileCacheDir: join(ART, "ncaaf-e2b-early-snapshots"),
  timingNotes: [
    "date= kickoff − 24h truncated to UTC minute",
    "Need two-sided American ML (home+away) from real books",
    "R1: fixture home-only fallback insufficient for C1 on clean path",
    "R2: away ML only from this early cache",
    "Selection timestamp must be recorded for CLV",
    "Coach selection rules locked before price-delta inspection",
  ],
  coverageLimitations: [
    "Early snapshot cache currently EMPTY (0 files)",
    "Home-only selection-prices fixture cannot supply away ML under R1–R2",
    "Separate hard cap from close-only manifest — do not co-mingle spend",
    "Combined close+early spend must stay ≤ 4200 credits",
    "Phase-e CLV fail (n=15, meanClv<0) is failed evidence on prior stamp — remake on clean E1 after cache exists",
    "Paid historical only; key unset — manifest is pre-retrieval",
    "T−24h timing feasible post-Sep-2022; entitlement unconfirmed without ODDS_API_KEY",
  ],
});

const combinedBase =
  closeManifest.creditMath.baseCredits + clvManifest.creditMath.baseCredits;
const combinedWithBuffers =
  closeManifest.creditMath.baseCredits +
  closeManifest.creditMath.retryBufferCredits +
  clvManifest.creditMath.baseCredits +
  clvManifest.creditMath.retryBufferCredits;

const bundle = {
  generatedAt: new Date().toISOString(),
  phase: "C_D_regenerated",
  paidRetrieval: false,
  coachSelectionRulesLocked: true,
  t24hAvailabilityChecked: true,
  priceDeltasExamined: false,
  separateHardCaps: {
    closeH2h: CLOSE_HARD_CAP,
    earlyClvH2h: EARLY_HARD_CAP,
    combinedMaximum: COMBINED_MAX_CREDITS,
    invariant: "close + early hard caps == 4200",
    note: "Spend each pull under its own cap; never exceed combined 4200 across both",
  },
  combinedCreditCheck: {
    baseSum: combinedBase,
    basePlusRetryBuffersSum: combinedWithBuffers,
    withinCombinedMaxIfBothAtHardCap: CLOSE_HARD_CAP + EARLY_HARD_CAP <= COMBINED_MAX_CREDITS,
    bothFitsOwnCap:
      closeManifest.creditMath.fitsInHardCap && clvManifest.creditMath.fitsInHardCap,
  },
  closeOnlyH2h: closeManifest,
  earlyTwoSidedClv: clvManifest,
};

writeFileSync(
  join(FIX, "ncaaf-final-eval-odds-request-manifests.json"),
  JSON.stringify(bundle, null, 2) + "\n",
);

const md = `# Odds request manifests (Phase C/D) — dry-run only

**Generated:** ${bundle.generatedAt}  
**Paid retrieval:** **false** · ODDS_API_KEY unset · no plan changes  
**Coach selection rules:** locked · **T−24h availability:** checked · **price deltas:** not examined

## Separate hard credit caps (combined max 4200)

| Manifest | Markets | Buckets to fetch | Base credits | Retry buffer | **Hard cap** | Fits |
|----------|---------|-----------------:|-------------:|-------------:|-------------:|:----:|
| Close-only h2h | h2h | ${closeManifest.nBucketsToFetch} | ${closeManifest.creditMath.baseCredits} | ${closeManifest.creditMath.retryBufferCredits} | **${CLOSE_HARD_CAP}** | ${closeManifest.creditMath.fitsInHardCap} |
| Early T−24h h2h CLV | h2h | ${clvManifest.nBucketsToFetch} | ${clvManifest.creditMath.baseCredits} | ${clvManifest.creditMath.retryBufferCredits} | **${EARLY_HARD_CAP}** | ${clvManifest.creditMath.fitsInHardCap} |
| **Combined** | — | — | ${combinedBase} | — | **${COMBINED_MAX_CREDITS}** | ${combinedWithBuffers <= COMBINED_MAX_CREDITS} |

Caps are **separate**. Combined spend across both pulls must stay ≤ **4200**.

## Deduplication

| Source | Close manifest | Early CLV manifest |
|--------|----------------|--------------------|
| TUNING close minute buckets | ${closeManifest.deduplication.againstTuningCloseBuckets} known; skip overlap | not applicable (different as-of) |
| File cache | \`${closeManifest.deduplication.fileCacheDir}\` (n=${closeManifest.deduplication.fileCacheCount}) | \`${clvManifest.deduplication.fileCacheDir}\` (n=${clvManifest.deduplication.fileCacheCount}) |
| Buckets skipped | ${closeManifest.nBucketsSkipped} | ${clvManifest.nBucketsSkipped} |

## Timing / coverage limitations

### Close-only h2h
${closeManifest.timingNotes.map((t) => `- ${t}`).join("\n")}
${closeManifest.coverageLimitations.map((t) => `- ⚠ ${t}`).join("\n")}

### Early two-sided CLV
${clvManifest.timingNotes.map((t) => `- ${t}`).join("\n")}
${clvManifest.coverageLimitations.map((t) => `- ⚠ ${t}`).join("\n")}

## Non-actions this turn

No HTTP to Odds API · no FINAL_EVAL scoring · no deploy/OTA/unlock · spreads remain blocked
`;

writeFileSync(join(FIX, "ncaaf-final-eval-odds-request-manifests.md"), md);
writeFileSync(join(DOCS, "ncaaf-final-eval-odds-request-manifests.md"), md);

console.log(
  JSON.stringify(
    {
      close: {
        buckets: closeManifest.nPrimaryBuckets,
        toFetch: closeManifest.nBucketsToFetch,
        base: closeManifest.creditMath.baseCredits,
        hardCap: closeManifest.creditMath.hardCap,
      },
      earlyClv: {
        buckets: clvManifest.nPrimaryBuckets,
        toFetch: clvManifest.nBucketsToFetch,
        base: clvManifest.creditMath.baseCredits,
        hardCap: clvManifest.creditMath.hardCap,
      },
      paidRetrieval: false,
    },
    null,
    2,
  ),
);
