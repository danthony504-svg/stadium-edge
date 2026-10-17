/**
 * Cache-only alias rematch for FINAL_EVAL close/early ML archives.
 *
 * - Preserves frozen 408-game membership (read-only)
 * - No Odds HTTP
 * - Rejects ambiguous matches
 * - Keeps 5 empty-bookmaker shells explicitly missing
 * - Expected max paired coverage: 403/408
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "../test/fixtures");
const ART = "/opt/cursor/artifacts";
const DOCS = join(HERE, "../../../docs/coach");
const CLOSE_CACHE = join(ART, "ncaaf-e2b-close-snapshots");
const EARLY_CACHE = join(ART, "ncaaf-e2b-early-snapshots");

/** Verified ESPN → Odds display aliases (bidirectional via normalization). */
const VERIFIED_ALIAS_CANON: Record<string, string> = {
  "sam houston bearkats": "sam houston",
  "sam houston state bearkats": "sam houston",
  "sam houston": "sam houston",
  "massachusetts minutemen": "umass",
  "umass minutemen": "umass",
  "umass": "umass",
  "app state mountaineers": "appalachian state",
  "appalachian state mountaineers": "appalachian state",
  "appalachian state": "appalachian state",
  "san jose state spartans": "san jose state",
  "san jose state": "san jose state",
  "hawaii rainbow warriors": "hawaii",
  "hawaii": "hawaii",
  "southern miss golden eagles": "southern miss",
  "southern mississippi golden eagles": "southern miss",
  "southern mississippi": "southern miss",
  "southern miss": "southern miss",
  "louisiana ragin cajuns": "louisiana",
  "louisiana": "louisiana",
  "ul monroe warhawks": "ul monroe",
  "louisiana monroe warhawks": "ul monroe",
  "ul monroe": "ul monroe",
};

type MemGame = {
  eventId: string;
  season: number;
  week?: number;
  kickoffIso: string;
  homeTeamId: string;
  awayTeamId: string;
  homeName: string;
  awayName: string;
  venueKind?: string;
  homeFg?: number | null;
  awayFg?: number | null;
  outcomeSealed?: boolean;
};

type ArchiveRow = {
  gameId: string;
  season?: number;
  week?: number;
  home: string;
  away: string;
  kickoffIso: string;
  oddsCommenceTime?: string;
  requestDate?: string;
  snapshotTimestamp?: string;
  mlHome: number;
  mlAway: number;
  bookSample?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  phase: string;
  source: string;
  twoSided: true;
  matchSource?: string;
  matchKind?: string;
  integrity?: Record<string, unknown>;
};

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function normName(name: string): string {
  return (name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function schoolKey(name: string): string {
  const n = normName(name);
  const parts = n.split(" ");
  return parts.length >= 2 ? parts.slice(0, -1).join(" ") : n;
}

function canonTeam(name: string): string {
  const n = normName(name);
  if (VERIFIED_ALIAS_CANON[n]) return VERIFIED_ALIAS_CANON[n];
  const sk = schoolKey(name);
  if (VERIFIED_ALIAS_CANON[sk]) return VERIFIED_ALIAS_CANON[sk];
  return sk || n;
}

function teamsEqual(a: string, b: string): boolean {
  return canonTeam(a) === canonTeam(b) || normName(a) === normName(b);
}

function parseIso(iso: string): number {
  const s = iso.endsWith("Z") ? iso.slice(0, -1) + "+00:00" : iso;
  return Date.parse(s);
}

function cachePath(dir: string, bucketIso: string): string | null {
  const cands = [
    join(dir, `${bucketIso.replace(/:/g, "-")}.json`),
    join(dir, `${bucketIso.replace(/:/g, "")}.json`),
  ];
  for (const p of cands) if (existsSync(p)) return p;
  return null;
}

function extractMl(
  event: Record<string, unknown>,
  teamName: string,
): { price: number | null; book: string | null } {
  const prefer = ["draftkings", "fanduel", "betmgm", "williamhill_us", "bovada"];
  const books = [...((event.bookmakers as Array<Record<string, unknown>>) || [])];
  books.sort((a, b) => {
    const ia = prefer.indexOf(String(a.key || ""));
    const ib = prefer.indexOf(String(b.key || ""));
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  for (const b of books) {
    const markets = (b.markets as Array<Record<string, unknown>>) || [];
    const h2h = markets.find((m) => m.key === "h2h");
    if (!h2h) continue;
    for (const o of (h2h.outcomes as Array<Record<string, unknown>>) || []) {
      if (teamsEqual(teamName, String(o.name || "")) && o.price != null) {
        return { price: Number(o.price), book: String(b.key || "") };
      }
    }
  }
  return { price: null, book: null };
}

type Cand = {
  event: Record<string, unknown>;
  kind: "exact" | "alias_verified" | "school";
  swapped: boolean;
};

function findCandidates(
  home: string,
  away: string,
  events: Array<Record<string, unknown>>,
): Cand[] {
  const out: Cand[] = [];
  const ch = canonTeam(home);
  const ca = canonTeam(away);
  for (const ev of events) {
    const eh = String(ev.home_team || "");
    const ea = String(ev.away_team || "");
    const ceh = canonTeam(eh);
    const cea = canonTeam(ea);
    if (ceh === ch && cea === ca) {
      const kind =
        normName(eh) === normName(home) && normName(ea) === normName(away)
          ? "exact"
          : teamsEqual(home, eh) && teamsEqual(away, ea)
            ? "alias_verified"
            : "school";
      out.push({ event: ev, kind, swapped: false });
    } else if (ceh === ca && cea === ch) {
      // Swapped venue naming — reject for identity integrity (home/away must agree)
      out.push({ event: ev, kind: "alias_verified", swapped: true });
    }
  }
  return out;
}

/** Accept only a unique non-swapped candidate with kickoff/commence alignment. */
function acceptUnique(
  g: MemGame,
  cands: Cand[],
):
  | { ok: true; cand: Cand; commence: string; kickoffDeltaMin: number }
  | { ok: false; reason: string; nCands: number } {
  const oriented = cands.filter((c) => !c.swapped);
  if (oriented.length === 0) {
    if (cands.some((c) => c.swapped)) {
      return { ok: false, reason: "rejected_swapped_home_away", nCands: cands.length };
    }
    return { ok: false, reason: "no_odds_match", nCands: 0 };
  }
  if (oriented.length > 1) {
    return { ok: false, reason: "ambiguous_multiple_events", nCands: oriented.length };
  }
  const cand = oriented[0]!;
  const commence = String(cand.event.commence_time || "");
  if (!commence) return { ok: false, reason: "missing_commence", nCands: 1 };
  const kickMs = parseIso(g.kickoffIso);
  const comMs = parseIso(commence);
  if (!Number.isFinite(kickMs) || !Number.isFinite(comMs)) {
    return { ok: false, reason: "bad_timestamps", nCands: 1 };
  }
  const deltaMin = Math.abs(kickMs - comMs) / 60000;
  // Locked integrity: commence within 3h of ESPN kickoff
  if (deltaMin > 180) {
    return { ok: false, reason: "kickoff_commence_mismatch", nCands: 1 };
  }
  // Season check from kickoff year
  const seasonFromKick = new Date(kickMs).getUTCFullYear();
  // NCAAF late-year bowls can be Dec/Jan — membership season is authoritative;
  // require kickoff year in {season, season+1} for Jan bowls, else equal.
  if (seasonFromKick !== g.season && seasonFromKick !== g.season + 1) {
    return { ok: false, reason: "season_mismatch", nCands: 1 };
  }
  return { ok: true, cand, commence, kickoffDeltaMin: deltaMin };
}

function rematchPhase(
  phase: "close" | "early",
  membership: MemGame[],
  existingMatched: ArchiveRow[],
  existingMissing: Array<Record<string, unknown>>,
  requests: Array<{ bucketIso: string; eventIds: string[] }>,
  cacheDir: string,
  requirePreKick: boolean,
): {
  games: ArchiveRow[];
  missing: Array<Record<string, unknown>>;
  stats: Record<string, number>;
} {
  const byId = new Map(membership.map((g) => [g.eventId, g]));
  const kept = new Map(existingMatched.map((g) => [g.gameId, g]));
  const missingOut: Array<Record<string, unknown>> = [];
  const stats = {
    keptPrior: kept.size,
    rematched: 0,
    emptyBookmakers: 0,
    ambiguous: 0,
    rejectedSwapped: 0,
    stillNoMatch: 0,
    other: 0,
  };

  const missingIds = new Set(existingMissing.map((m) => String(m.eventId)));

  for (const m of existingMissing) {
    const eid = String(m.eventId);
    const g = byId.get(eid);
    if (!g) {
      missingOut.push({ ...m, reason: "not_in_membership" });
      stats.other++;
      continue;
    }
    const req = requests.find((r) => r.eventIds.includes(eid));
    const bucket = req?.bucketIso;
    if (!bucket) {
      missingOut.push({
        eventId: eid,
        reason: "no_manifest_bucket",
        home: g.homeName,
        away: g.awayName,
        kickoffIso: g.kickoffIso,
        phase,
      });
      stats.other++;
      continue;
    }
    const path = cachePath(cacheDir, bucket);
    if (!path) {
      missingOut.push({
        eventId: eid,
        reason: "cache_file_missing",
        bucketIso: bucket,
        home: g.homeName,
        away: g.awayName,
        phase,
      });
      stats.other++;
      continue;
    }
    const payload = loadJson<{
      snapshotTimestamp?: string;
      events?: Array<Record<string, unknown>>;
      requestDate?: string;
    }>(path);
    const events = payload.events || [];
    const cands = findCandidates(g.homeName, g.awayName, events);
    const acc = acceptUnique(g, cands);
    if (!acc.ok) {
      if (acc.reason === "ambiguous_multiple_events") stats.ambiguous++;
      else if (acc.reason === "rejected_swapped_home_away") stats.rejectedSwapped++;
      else if (acc.reason === "no_odds_match") stats.stillNoMatch++;
      else stats.other++;
      missingOut.push({
        eventId: eid,
        reason: acc.reason,
        home: g.homeName,
        away: g.awayName,
        kickoffIso: g.kickoffIso,
        season: g.season,
        week: g.week,
        nCands: acc.nCands,
        phase,
        matchSource: "cache_alias_rematch_rejected",
      });
      continue;
    }

    const books = (acc.cand.event.bookmakers as unknown[]) || [];
    if (!books.length) {
      stats.emptyBookmakers++;
      missingOut.push({
        eventId: eid,
        reason: "empty_bookmakers",
        home: g.homeName,
        away: g.awayName,
        kickoffIso: g.kickoffIso,
        oddsCommenceTime: acc.commence,
        snapshotTimestamp: payload.snapshotTimestamp,
        season: g.season,
        week: g.week,
        phase,
        matchSource: "cache_alias_rematch",
        matchKind: acc.cand.kind,
        note: "Event on slate with bookmakers=[]; keep explicitly missing",
      });
      continue;
    }

    const mh = extractMl(acc.cand.event, g.homeName);
    const ma = extractMl(acc.cand.event, g.awayName);
    if (mh.price == null || ma.price == null) {
      stats.other++;
      missingOut.push({
        eventId: eid,
        reason: "missing_two_sided_ml",
        home: g.homeName,
        away: g.awayName,
        kickoffIso: g.kickoffIso,
        mlHome: mh.price,
        mlAway: ma.price,
        phase,
        matchSource: "cache_alias_rematch",
      });
      continue;
    }

    const snap = payload.snapshotTimestamp;
    if (requirePreKick && snap && parseIso(snap) >= parseIso(acc.commence)) {
      stats.other++;
      missingOut.push({
        eventId: eid,
        reason: "snapshot_not_before_commence",
        kickoffIso: g.kickoffIso,
        snapshotTimestamp: snap,
        commenceTime: acc.commence,
        phase,
      });
      continue;
    }

    // Early timing band around T−24h (20–28h) — soft check; hard reject if snap after kickoff
    if (!requirePreKick && snap) {
      const hoursToKick = (parseIso(g.kickoffIso) - parseIso(snap)) / 3_600_000;
      if (hoursToKick < 0) {
        stats.other++;
        missingOut.push({
          eventId: eid,
          reason: "early_snap_after_kickoff",
          hoursToKick,
          phase,
        });
        continue;
      }
    }

    const row: ArchiveRow = {
      gameId: eid,
      season: g.season,
      week: g.week,
      home: g.homeName,
      away: g.awayName,
      kickoffIso: g.kickoffIso,
      oddsCommenceTime: acc.commence,
      requestDate: payload.requestDate || bucket,
      snapshotTimestamp: snap,
      mlHome: mh.price,
      mlAway: ma.price,
      bookSample: mh.book || ma.book,
      homeScore: g.homeFg ?? null,
      awayScore: g.awayFg ?? null,
      phase,
      source: "the-odds-api-historical-h2h",
      twoSided: true,
      matchSource: "cache_alias_rematch",
      matchKind: acc.cand.kind,
      integrity: {
        season: g.season,
        homeTeamId: g.homeTeamId,
        awayTeamId: g.awayTeamId,
        kickoffCommenceDeltaMin: acc.kickoffDeltaMin,
        oddsHome: acc.cand.event.home_team,
        oddsAway: acc.cand.event.away_team,
        canonHome: canonTeam(g.homeName),
        canonAway: canonTeam(g.awayName),
      },
    };
    kept.set(eid, row);
    stats.rematched++;
    missingIds.delete(eid);
  }

  // Preserve prior matched (already integrity-checked at pull time); stamp source
  const games = [...kept.values()].sort((a, b) =>
    a.kickoffIso.localeCompare(b.kickoffIso),
  );
  for (const g of games) {
    if (!g.matchSource) g.matchSource = "original_pull";
  }

  return { games, missing: missingOut, stats };
}

function main(): void {
  const membership = loadJson<{ games: MemGame[]; split?: string }>(
    join(FIX, "ncaaf-final-eval-membership-games.json"),
  );
  if (membership.games.length !== 408) {
    throw new Error(`membership must remain 408, got ${membership.games.length}`);
  }
  const closeArch = loadJson<{
    games: ArchiveRow[];
    missing: Array<Record<string, unknown>>;
    scored?: boolean;
  }>(join(FIX, "ncaaf-final-eval-close-h2h-archive.json"));
  const earlyArch = loadJson<{
    games: ArchiveRow[];
    missing: Array<Record<string, unknown>>;
    scored?: boolean;
  }>(join(FIX, "ncaaf-final-eval-early-t24h-h2h-archive.json"));
  const manifests = loadJson<{
    closeOnlyH2h: { requests: Array<{ bucketIso: string; eventIds: string[] }> };
    earlyTwoSidedClv: {
      requests: Array<{ bucketIso: string; eventIds: string[] }>;
    };
  }>(join(FIX, "ncaaf-final-eval-odds-request-manifests.json"));

  const close = rematchPhase(
    "close",
    membership.games,
    closeArch.games,
    closeArch.missing,
    manifests.closeOnlyH2h.requests,
    CLOSE_CACHE,
    true,
  );
  const early = rematchPhase(
    "early",
    membership.games,
    earlyArch.games,
    earlyArch.missing,
    manifests.earlyTwoSidedClv.requests,
    EARLY_CACHE,
    false,
  );

  const closeIds = new Set(close.games.map((g) => g.gameId));
  const earlyIds = new Set(early.games.map((g) => g.gameId));
  const pairedIds = [...closeIds].filter((id) => earlyIds.has(id));
  const closeOnly = [...closeIds].filter((id) => !earlyIds.has(id));
  const earlyOnly = [...earlyIds].filter((id) => !closeIds.has(id));

  // Timing recheck on paired
  let closePreOk = 0;
  let closePreFail = 0;
  let earlyBandOk = 0;
  let earlyBandFail = 0;
  for (const id of pairedIds) {
    const c = close.games.find((g) => g.gameId === id)!;
    const e = early.games.find((g) => g.gameId === id)!;
    if (
      c.snapshotTimestamp &&
      c.oddsCommenceTime &&
      parseIso(c.snapshotTimestamp) < parseIso(c.oddsCommenceTime)
    ) {
      closePreOk++;
    } else closePreFail++;
    if (e.snapshotTimestamp) {
      const h = (parseIso(e.kickoffIso) - parseIso(e.snapshotTimestamp)) / 3_600_000;
      if (h >= 20 && h <= 28) earlyBandOk++;
      else earlyBandFail++;
    } else earlyBandFail++;
  }

  const emptyClose = close.missing.filter((m) => m.reason === "empty_bookmakers");
  const emptyEarly = early.missing.filter((m) => m.reason === "empty_bookmakers");

  const integrityPass =
    pairedIds.length === 403 &&
    close.games.length === 403 &&
    early.games.length === 403 &&
    closeOnly.length === 0 &&
    earlyOnly.length === 0 &&
    emptyClose.length === 5 &&
    emptyEarly.length === 5 &&
    closePreFail === 0 &&
    earlyBandFail === 0 &&
    membership.games.length === 408;

  const closeOut = {
    version: 2,
    split: "FINAL_EVAL",
    archive: "close_h2h",
    scored: false,
    markets: ["h2h"],
    generatedAt: new Date().toISOString(),
    rematch: "cache_alias_verified",
    paidHttp: 0,
    membershipN: 408,
    membershipPreserved: true,
    games: close.games,
    missing: close.missing,
    rematchStats: close.stats,
    integrity: {
      pairedWithEarly: pairedIds.length,
      closePreCommenceOk: closePreOk,
      closePreCommenceFail: closePreFail,
      emptyBookmakersKeptMissing: emptyClose.length,
      expectedMaxCoverage: "403/408",
      pass: integrityPass,
    },
  };
  const earlyOut = {
    version: 2,
    split: "FINAL_EVAL",
    archive: "early_t24h_h2h_twosided",
    scored: false,
    markets: ["h2h"],
    generatedAt: new Date().toISOString(),
    rematch: "cache_alias_verified",
    paidHttp: 0,
    membershipN: 408,
    membershipPreserved: true,
    games: early.games,
    missing: early.missing,
    rematchStats: early.stats,
    integrity: {
      pairedWithClose: pairedIds.length,
      earlyT24hBandOk: earlyBandOk,
      earlyT24hBandFail: earlyBandFail,
      emptyBookmakersKeptMissing: emptyEarly.length,
      expectedMaxCoverage: "403/408",
      pass: integrityPass,
    },
  };

  const report = {
    generatedAt: new Date().toISOString(),
    paidHttp: 0,
    membershipN: 408,
    membershipPreserved: true,
    closeMatched: close.games.length,
    earlyMatched: early.games.length,
    paired: pairedIds.length,
    closeOnly: closeOnly.length,
    earlyOnly: earlyOnly.length,
    emptyBookmakers: {
      close: emptyClose.map((m) => m.eventId),
      early: emptyEarly.map((m) => m.eventId),
    },
    rematchStats: { close: close.stats, early: early.stats },
    timing: {
      closePreOk,
      closePreFail,
      earlyBandOk,
      earlyBandFail,
    },
    integrityPass,
    expectedMaxCoverage: "403/408",
    note: integrityPass
      ? "Integrity checks PASS — safe to authorize frozen FINAL_EVAL scoring"
      : "Integrity checks FAIL — do not score until resolved",
  };

  const md = `# FINAL_EVAL cache alias rematch

**Paid HTTP:** 0 · **Membership:** 408 preserved · **Model/rules:** untouched  
**Expected max coverage:** 403/408 · **Empty-price shells kept missing:** 5

## Coverage
| Archive | Matched | Missing | Empty books |
|---------|--------:|--------:|------------:|
| Close h2h | ${close.games.length} | ${close.missing.length} | ${emptyClose.length} |
| Early T−24h | ${early.games.length} | ${early.missing.length} | ${emptyEarly.length} |
| **Paired same gameId** | **${pairedIds.length}** | — | — |

## Timing recheck
| Rule | Result |
|------|--------|
| Close snap &lt; commence | ${closePreOk} ok / ${closePreFail} fail |
| Early 20–28h band | ${earlyBandOk} ok / ${earlyBandFail} fail |

## Rematch stats (close)
${JSON.stringify(close.stats)}

## Integrity
**pass=${integrityPass}** — ${report.note}

Empty bookmaker eventIds: ${emptyClose.map((m) => m.eventId).join(", ")}
`;

  mkdirSync(ART, { recursive: true });
  for (const [name, obj] of [
    ["ncaaf-final-eval-close-h2h-archive.json", closeOut],
    ["ncaaf-final-eval-early-t24h-h2h-archive.json", earlyOut],
    ["ncaaf-final-eval-alias-rematch-report.json", report],
  ] as const) {
    writeFileSync(join(FIX, name), JSON.stringify(obj, null, 2) + "\n");
    writeFileSync(join(ART, name), JSON.stringify(obj, null, 2) + "\n");
  }
  writeFileSync(join(FIX, "ncaaf-final-eval-alias-rematch-report.md"), md);
  writeFileSync(join(ART, "ncaaf-final-eval-alias-rematch-report.md"), md);
  writeFileSync(join(DOCS, "ncaaf-final-eval-alias-rematch-report.md"), md);

  console.log(JSON.stringify(report, null, 2));
  if (!integrityPass) process.exitCode = 2;
}

main();
