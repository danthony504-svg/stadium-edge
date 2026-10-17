/**
 * FINAL_EVAL archive scoring-readiness audit — CACHE ONLY.
 *
 * - No Odds HTTP / paid retrieval
 * - No engine scoring / prediction inspection
 * - Does not mutate membership, model params, or C1–C6 / R1–R4 locks
 *
 * Checks: missingness taxonomy (aliases / joins / two-sided), close↔early
 * gameId pairing, locked timing rules, M1–M4 / C1–C6 coverage readiness.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "../test/fixtures");
const ART = "/opt/cursor/artifacts";
const DOCS = join(HERE, "../../../docs/coach");
const CLOSE_CACHE = join(ART, "ncaaf-e2b-close-snapshots");
const EARLY_CACHE = join(ART, "ncaaf-e2b-early-snapshots");

type MemGame = {
  eventId: string;
  season?: number;
  week?: number;
  kickoffIso: string;
  homeName: string;
  awayName: string;
  homeFg?: number | null;
  awayFg?: number | null;
  venueKind?: string;
};

type ArchiveRow = {
  gameId: string;
  kickoffIso: string;
  oddsCommenceTime?: string;
  requestDate?: string;
  snapshotTimestamp?: string;
  mlHome?: number | null;
  mlAway?: number | null;
  twoSided?: boolean;
  home?: string;
  away?: string;
  homeScore?: number | null;
  awayScore?: number | null;
  phase?: string;
};

type MissingRow = {
  eventId: string;
  reason: string;
  kickoffIso?: string;
  home?: string;
  away?: string;
  snapshotTimestamp?: string;
  mlHome?: number | null;
  mlAway?: number | null;
  phase?: string;
};

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function normName(name: string): string {
  return (name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining accents (José→Jose, Hawaiʻi→Hawaii)
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

/** TUNING-style aliases observed in Odds naming (cache rematch heuristics). */
const ALIAS_TO_CANON: Record<string, string> = {
  "utsa roadrunners": "utsa",
  "texas san antonio": "utsa",
  "southern mississippi golden eagles": "southern miss",
  "southern miss golden eagles": "southern miss",
  "southern mississippi": "southern miss",
  "louisiana lafayette ragin cajuns": "louisiana",
  "louisiana ragin cajuns": "louisiana",
  "louisiana ragin": "louisiana",
  "ul lafayette": "louisiana",
  "miami ohio redhawks": "miami oh",
  "miami ohio": "miami oh",
  "miami fl hurricanes": "miami",
  "miami florida": "miami",
  "miami hurricanes": "miami",
  "connecticut huskies": "uconn",
  "uconn huskies": "uconn",
  "massachusetts minutemen": "umass",
  "umass minutemen": "umass",
  "hawaii rainbow warriors": "hawaii",
  "hawaii": "hawaii",
  "san jose state spartans": "san jose state",
  "san jose state": "san jose state",
  "sam houston state bearkats": "sam houston",
  "sam houston bearkats": "sam houston",
  "appalachian state mountaineers": "app state",
  "appalachian state": "app state",
  "florida international panthers": "fiu",
  "fiu panthers": "fiu",
  "middle tennessee blue raiders": "middle tennessee",
  "middle tennessee state": "middle tennessee",
  "louisiana monroe warhawks": "ul monroe",
  "ul monroe warhawks": "ul monroe",
  "ulm warhawks": "ul monroe",
  "texas am aggies": "texas am",
  "texas a m aggies": "texas am",
  "nc state wolfpack": "north carolina state",
  "north carolina state wolfpack": "north carolina state",
  "ole miss rebels": "mississippi",
  "mississippi rebels": "mississippi",
  "pitt panthers": "pittsburgh",
  "pittsburgh panthers": "pittsburgh",
};

function aliasKey(name: string): string {
  const n = normName(name);
  if (ALIAS_TO_CANON[n]) return ALIAS_TO_CANON[n];
  const sk = schoolKey(name);
  if (ALIAS_TO_CANON[sk]) return ALIAS_TO_CANON[sk];
  // strip common mascot endings for broader match
  return sk;
}

function namesLooseMatch(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const sa = aliasKey(a);
  const sb = aliasKey(b);
  if (sa && sb && sa === sb) return true;
  const ska = schoolKey(a);
  const skb = schoolKey(b);
  if (ska && skb && (ska === skb || ska.includes(skb) || skb.includes(ska))) return true;
  return false;
}

function findEvent(
  home: string,
  away: string,
  events: Array<Record<string, unknown>>,
): { event: Record<string, unknown>; matchKind: string } | null {
  const hk = normName(home);
  const ak = normName(away);
  const sh = schoolKey(home);
  const sa = schoolKey(away);
  const ah = aliasKey(home);
  const aa = aliasKey(away);

  for (const ev of events) {
    const eh = normName(String(ev.home_team || ""));
    const ea = normName(String(ev.away_team || ""));
    const esh = schoolKey(String(ev.home_team || ""));
    const esa = schoolKey(String(ev.away_team || ""));
    const eah = aliasKey(String(ev.home_team || ""));
    const eaa = aliasKey(String(ev.away_team || ""));

    if (new Set([eh, ea]).size === 2 && new Set([eh, ea]).has(hk) && new Set([eh, ea]).has(ak)) {
      return { event: ev, matchKind: "exact_norm" };
    }
    if (new Set([esh, esa]).size === 2 && new Set([esh, esa]).has(sh) && new Set([esh, esa]).has(sa)) {
      return { event: ev, matchKind: "school_key" };
    }
    if (new Set([eah, eaa]).size === 2 && new Set([eah, eaa]).has(ah) && new Set([eah, eaa]).has(aa)) {
      return { event: ev, matchKind: "alias_key" };
    }
    if (namesLooseMatch(home, String(ev.home_team || "")) && namesLooseMatch(away, String(ev.away_team || ""))) {
      return { event: ev, matchKind: "loose_home_away" };
    }
    if (namesLooseMatch(home, String(ev.away_team || "")) && namesLooseMatch(away, String(ev.home_team || ""))) {
      return { event: ev, matchKind: "loose_swapped" };
    }
  }
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
    const markets = ((b.markets as Array<Record<string, unknown>>) || []).reduce(
      (acc, m) => {
        acc[String(m.key)] = m;
        return acc;
      },
      {} as Record<string, Record<string, unknown>>,
    );
    const h2h = markets.h2h;
    if (!h2h) continue;
    for (const o of (h2h.outcomes as Array<Record<string, unknown>>) || []) {
      if (namesLooseMatch(teamName, String(o.name || "")) && o.price != null) {
        return { price: Number(o.price), book: String(b.key || null) };
      }
    }
  }
  return { price: null, book: null };
}

function cachePath(dir: string, bucketIso: string): string | null {
  const a = join(dir, `${bucketIso.replace(/:/g, "-")}.json`);
  const b = join(dir, `${bucketIso.replace(/:/g, "")}.json`);
  if (existsSync(a)) return a;
  if (existsSync(b)) return b;
  // also try without seconds if present
  const trimmed = bucketIso.replace(/:\d{2}Z$/, "Z").replace(/Z$/, ":00Z");
  const c = join(dir, `${trimmed.replace(/:/g, "-")}.json`);
  const d = join(dir, `${trimmed.replace(/:/g, "")}.json`);
  if (existsSync(c)) return c;
  if (existsSync(d)) return d;
  return null;
}

function parseIso(iso: string): number {
  const s = iso.endsWith("Z") ? iso.slice(0, -1) + "+00:00" : iso;
  return Date.parse(s);
}

function hoursBetween(a: string, b: string): number {
  return (parseIso(b) - parseIso(a)) / 3_600_000;
}

function bucketFromKickoff(kickoffIso: string): string {
  const d = new Date(parseIso(kickoffIso));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}:00Z`;
}

function earlyBucketFromKickoff(kickoffIso: string): string {
  const d = new Date(parseIso(kickoffIso) - 24 * 3_600_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}:00Z`;
}

function isFcsHeuristic(name: string): boolean {
  // Lightweight name heuristic — not a full FBS roster. Flags known FCS tokens.
  const n = normName(name);
  const fcsHints = [
    "houston christian",
    "incarnate word",
    "stephen f austin",
    "northwestern state",
    "southeastern louisiana",
    "nicholls",
    "mcneese",
    "lamar",
    "prairie view",
    "grambling",
    "southern university",
    "alabama a m",
    "alabama state",
    "jackson state",
    "alcorn",
    "bethune cookman",
    "florida a m",
    "north carolina a t",
    "howard",
    "morgan state",
    "delaware state",
    "norfolk state",
    "south carolina state",
    "tennessee state",
    "tennessee tech",
    "eastern kentucky",
    "austin peay",
    "murray state",
    "ut martin",
    "southeast missouri",
    "illinois state",
    "indiana state",
    "northern iowa",
    "south dakota state",
    "north dakota state",
    "north dakota ",
    "south dakota ",
    "youngstown state",
    "missouri state",
    "southern illinois",
    "western illinois",
    "eastern illinois",
    "montana state",
    "montana ",
    "idaho state",
    "weber state",
    "eastern washington",
    "portland state",
    "sacramento state",
    "uc davis",
    "cal poly",
    "northern arizona",
    "northern colorado",
    "idaho ",
    "furman",
    "chattanooga",
    "the citadel",
    "vmi ",
    "wofford",
    "samford",
    "mercer",
    "etsu",
    "east tennessee",
    "western carolina",
    "elon",
    "towson",
    "william mary",
    "james madison", // historically FCS transition edge cases handled by membership
    "richmond",
    "villanova",
    "new hampshire",
    "maine ",
    "albany ",
    "stony brook",
    "monmouth",
    "campbell",
    "charleston southern",
    "gardner webb",
    "presbyterian",
    "davidson",
    "butler",
    "drake",
    "dayton",
    "san diego toreros",
    "st thomas",
    "valparaiso",
    "marist",
    "holy cross",
    "colgate",
    "lafayette",
    "lehigh",
    "bucknell",
    "fordham",
    "georgetown",
    "harvard",
    "yale",
    "princeton",
    "penn ",
    "columbia",
    "cornell",
    "brown",
    "dartmouth",
  ];
  return fcsHints.some((h) => n.includes(h.trim()));
}

function main(): void {
  const membership = loadJson<{ games: MemGame[]; split?: string }>(
    join(FIX, "ncaaf-final-eval-membership-games.json"),
  );
  const closeArch = loadJson<{
    games: ArchiveRow[];
    missing: MissingRow[];
    scored?: boolean;
    timestampValidity?: Record<string, number>;
  }>(join(FIX, "ncaaf-final-eval-close-h2h-archive.json"));
  const earlyArch = loadJson<{
    games: ArchiveRow[];
    missing: MissingRow[];
    scored?: boolean;
    timestampValidity?: Record<string, number>;
  }>(join(FIX, "ncaaf-final-eval-early-t24h-h2h-archive.json"));
  const manifests = loadJson<Record<string, unknown>>(
    join(FIX, "ncaaf-final-eval-odds-request-manifests.json"),
  );

  const memById = new Map(membership.games.map((g) => [g.eventId, g]));
  const closeById = new Map(closeArch.games.map((g) => [g.gameId, g]));
  const earlyById = new Map(earlyArch.games.map((g) => [g.gameId, g]));
  const closeMissingIds = new Set(closeArch.missing.map((m) => m.eventId));
  const earlyMissingIds = new Set(earlyArch.missing.map((m) => m.eventId));

  // --- Pairing ---
  const closeIds = new Set(closeById.keys());
  const earlyIds = new Set(earlyById.keys());
  const pairedIds = [...closeIds].filter((id) => earlyIds.has(id));
  const closeOnly = [...closeIds].filter((id) => !earlyIds.has(id));
  const earlyOnly = [...earlyIds].filter((id) => !closeIds.has(id));
  const missingEqual = [...closeMissingIds].sort().join() === [...earlyMissingIds].sort().join();

  // --- Timing on paired matched rows ---
  const timing = {
    closePreCommenceOk: 0,
    closePreCommenceFail: 0,
    closeMissingCommenceOrSnap: 0,
    earlyHoursToKick: [] as number[],
    earlyOutside20to28h: 0,
    earlyOk20to28h: 0,
    requestDateEqualsKickoffMinute: 0,
    requestDateMismatch: 0,
  };
  for (const id of pairedIds) {
    const c = closeById.get(id)!;
    const e = earlyById.get(id)!;
    if (c.snapshotTimestamp && c.oddsCommenceTime) {
      if (parseIso(c.snapshotTimestamp) < parseIso(c.oddsCommenceTime)) timing.closePreCommenceOk++;
      else timing.closePreCommenceFail++;
    } else {
      timing.closeMissingCommenceOrSnap++;
    }
    if (e.snapshotTimestamp && e.kickoffIso) {
      const h = hoursBetween(e.snapshotTimestamp, e.kickoffIso);
      timing.earlyHoursToKick.push(h);
      if (h >= 20 && h <= 28) timing.earlyOk20to28h++;
      else timing.earlyOutside20to28h++;
    }
    const expectClose = bucketFromKickoff(c.kickoffIso);
    const rd = (c.requestDate || "").replace(/\.000Z$/, "Z");
    if (rd === expectClose || rd.replace(/:00Z$/, "Z") === expectClose.replace(/:00Z$/, "Z")) {
      timing.requestDateEqualsKickoffMinute++;
    } else {
      timing.requestDateMismatch++;
    }
  }
  const earlyHoursSorted = [...timing.earlyHoursToKick].sort((a, b) => a - b);
  const earlyHoursSummary = earlyHoursSorted.length
    ? {
        n: earlyHoursSorted.length,
        min: earlyHoursSorted[0],
        p50: earlyHoursSorted[Math.floor(earlyHoursSorted.length / 2)],
        max: earlyHoursSorted[earlyHoursSorted.length - 1],
        mean:
          earlyHoursSorted.reduce((s, x) => s + x, 0) / earlyHoursSorted.length,
      }
    : null;

  // --- Two-sided completeness on matched ---
  const closeTwoSided = closeArch.games.filter(
    (g) => g.mlHome != null && g.mlAway != null && g.twoSided !== false,
  ).length;
  const earlyTwoSided = earlyArch.games.filter(
    (g) => g.mlHome != null && g.mlAway != null && g.twoSided !== false,
  ).length;
  const pairedTwoSided = pairedIds.filter((id) => {
    const c = closeById.get(id)!;
    const e = earlyById.get(id)!;
    return c.mlHome != null && c.mlAway != null && e.mlHome != null && e.mlAway != null;
  }).length;

  // --- Cache-only audit of missing ---
  const missingAudits: Array<Record<string, unknown>> = [];
  const reasonTaxonomy = {
    no_odds_match: 0,
    missing_two_sided_ml: 0,
    other: 0,
  };
  const recoverableByAlias = { close: 0, early: 0, both: 0 };
  const eventPresentButNameMismatch = { close: 0, early: 0 };
  const eventAbsentFromSnapshot = { close: 0, early: 0 };
  const twoSidedRecoverableWithLoose = { close: 0, early: 0 };
  const fcsNameHits = 0;
  let fcsMissing = 0;
  const weekCounts: Record<string, number> = {};
  const cacheMissFile = { close: 0, early: 0 };

  for (const m of closeArch.missing) {
    reasonTaxonomy[m.reason as keyof typeof reasonTaxonomy] =
      (reasonTaxonomy[m.reason as keyof typeof reasonTaxonomy] ?? 0) + 1;
    if (!(m.reason in reasonTaxonomy)) reasonTaxonomy.other++;

    const g = memById.get(m.eventId);
    if (!g) continue;
    const wk = String(g.week ?? "?");
    weekCounts[wk] = (weekCounts[wk] || 0) + 1;
    if (isFcsHeuristic(g.homeName) || isFcsHeuristic(g.awayName)) fcsMissing++;

    const closeBucket = bucketFromKickoff(g.kickoffIso);
    const earlyBucket = earlyBucketFromKickoff(g.kickoffIso);
    const closePath = cachePath(CLOSE_CACHE, closeBucket) || cachePath(CLOSE_CACHE, m.kickoffIso || closeBucket);
    // also try archive snapshot request dates from sibling matched in same bucket
    const earlyPath = cachePath(EARLY_CACHE, earlyBucket);

    let closePayload: Record<string, unknown> | null = null;
    let earlyPayload: Record<string, unknown> | null = null;
    if (closePath && existsSync(closePath)) {
      closePayload = loadJson(closePath);
    } else {
      // scan cache files whose requestDate matches kickoff minute
      cacheMissFile.close++;
    }
    if (earlyPath && existsSync(earlyPath)) {
      earlyPayload = loadJson(earlyPath);
    } else {
      cacheMissFile.early++;
    }

    // If primary path miss, try finding any close cache file listing similar commence near kickoff
    if (!closePayload) {
      // fall back: use snapshotTimestamp from missing row — find file by scanning request dates in manifest
      const closeReqs = ((manifests.closeOnlyH2h as { requests?: Array<{ bucketIso: string; eventIds: string[] }> })
        ?.requests || []);
      const req = closeReqs.find((r) => r.eventIds.includes(m.eventId));
      if (req) {
        const p = cachePath(CLOSE_CACHE, req.bucketIso);
        if (p) closePayload = loadJson(p);
      }
    }
    if (!earlyPayload) {
      const earlyReqs = ((manifests.earlyTwoSidedClv as { requests?: Array<{ bucketIso: string; eventIds: string[] }> })
        ?.requests || []);
      const req = earlyReqs.find((r) => r.eventIds.includes(m.eventId));
      if (req) {
        const p = cachePath(EARLY_CACHE, req.bucketIso);
        if (p) earlyPayload = loadJson(p);
      }
    }

    const closeEvents = (closePayload?.events as Array<Record<string, unknown>>) || [];
    const earlyEvents = (earlyPayload?.events as Array<Record<string, unknown>>) || [];

    const closeHit = closeEvents.length ? findEvent(g.homeName, g.awayName, closeEvents) : null;
    const earlyHit = earlyEvents.length ? findEvent(g.homeName, g.awayName, earlyEvents) : null;

    // Puller's original find_event is stricter (no alias map). Replicate strict for comparison.
    const strictFind = (home: string, away: string, events: Array<Record<string, unknown>>) => {
      const hk = normName(home);
      const ak = normName(away);
      const sh = schoolKey(home);
      const sa = schoolKey(away);
      for (const ev of events) {
        const eh = normName(String(ev.home_team || ""));
        const ea = normName(String(ev.away_team || ""));
        const esh = schoolKey(String(ev.home_team || ""));
        const esa = schoolKey(String(ev.away_team || ""));
        if (new Set([eh, ea]).has(hk) && new Set([eh, ea]).has(ak) && eh && ea) return ev;
        if (new Set([esh, esa]).has(sh) && new Set([esh, esa]).has(sa) && esh && esa) return ev;
        if ((hk.includes(eh) || eh.includes(hk)) && (ak.includes(ea) || ea.includes(ak))) return ev;
        if ((hk.includes(ea) || ea.includes(hk)) && (ak.includes(eh) || eh.includes(ak))) return ev;
      }
      return null;
    };

    const closeStrict = closeEvents.length ? strictFind(g.homeName, g.awayName, closeEvents) : null;
    const earlyStrict = earlyEvents.length ? strictFind(g.homeName, g.awayName, earlyEvents) : null;

    let closeTwoSidedRecover: { mlHome: number | null; mlAway: number | null; matchKind?: string } | null =
      null;
    let earlyTwoSidedRecover: { mlHome: number | null; mlAway: number | null; matchKind?: string } | null =
      null;

    if (closeHit) {
      const mh = extractMl(closeHit.event, g.homeName);
      const ma = extractMl(closeHit.event, g.awayName);
      closeTwoSidedRecover = {
        mlHome: mh.price,
        mlAway: ma.price,
        matchKind: closeHit.matchKind,
      };
      if (mh.price != null && ma.price != null) recoverableByAlias.close++;
    } else if (closeEvents.length) {
      eventPresentButNameMismatch.close++; // slate has events but no join
      // Check if either school token appears at all
      const homeTok = schoolKey(g.homeName).split(" ")[0];
      const awayTok = schoolKey(g.awayName).split(" ")[0];
      const anyMention = closeEvents.some((ev) => {
        const blob = `${ev.home_team} ${ev.away_team}`.toLowerCase();
        return blob.includes(homeTok) || blob.includes(awayTok);
      });
      if (!anyMention) eventAbsentFromSnapshot.close++;
    }

    if (earlyHit) {
      const mh = extractMl(earlyHit.event, g.homeName);
      const ma = extractMl(earlyHit.event, g.awayName);
      earlyTwoSidedRecover = {
        mlHome: mh.price,
        mlAway: ma.price,
        matchKind: earlyHit.matchKind,
      };
      if (mh.price != null && ma.price != null) recoverableByAlias.early++;
    } else if (earlyEvents.length) {
      eventPresentButNameMismatch.early++;
      const homeTok = schoolKey(g.homeName).split(" ")[0];
      const awayTok = schoolKey(g.awayName).split(" ")[0];
      const anyMention = earlyEvents.some((ev) => {
        const blob = `${ev.home_team} ${ev.away_team}`.toLowerCase();
        return blob.includes(homeTok) || blob.includes(awayTok);
      });
      if (!anyMention) eventAbsentFromSnapshot.early++;
    }

    if (
      closeTwoSidedRecover?.mlHome != null &&
      closeTwoSidedRecover?.mlAway != null &&
      earlyTwoSidedRecover?.mlHome != null &&
      earlyTwoSidedRecover?.mlAway != null
    ) {
      recoverableByAlias.both++;
    }

    // For missing_two_sided_ml — event was found by puller; diagnose which side failed with loose extract
    let twoSidedDiag: Record<string, unknown> | null = null;
    if (m.reason === "missing_two_sided_ml" && closeStrict) {
      const mh = extractMl(closeStrict, g.homeName);
      const ma = extractMl(closeStrict, g.awayName);
      twoSidedDiag = {
        closeLooseMlHome: mh.price,
        closeLooseMlAway: ma.price,
        outcomes: ((closeStrict.bookmakers as Array<Record<string, unknown>>) || [])
          .slice(0, 1)
          .flatMap((b) => {
            const markets = (b.markets as Array<Record<string, unknown>>) || [];
            const h2h = markets.find((x) => x.key === "h2h");
            return ((h2h?.outcomes as Array<Record<string, unknown>>) || []).map((o) => o.name);
          }),
      };
      if (mh.price != null && ma.price != null) twoSidedRecoverableWithLoose.close++;
    }

    const nearestOddsNames = (closeEvents || [])
      .map((ev) => ({
        home_team: ev.home_team,
        away_team: ev.away_team,
        score:
          (namesLooseMatch(g.homeName, String(ev.home_team || "")) ? 2 : 0) +
          (namesLooseMatch(g.awayName, String(ev.away_team || "")) ? 2 : 0) +
          (schoolKey(g.homeName).split(" ")[0] &&
          String(ev.home_team || "")
            .toLowerCase()
            .includes(schoolKey(g.homeName).split(" ")[0])
            ? 1
            : 0) +
          (schoolKey(g.awayName).split(" ")[0] &&
          String(ev.away_team || "")
            .toLowerCase()
            .includes(schoolKey(g.awayName).split(" ")[0])
            ? 1
            : 0),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    missingAudits.push({
      eventId: m.eventId,
      week: g.week,
      season: g.season,
      kickoffIso: g.kickoffIso,
      home: g.homeName,
      away: g.awayName,
      pullerReason: m.reason,
      fcsNameHeuristic: isFcsHeuristic(g.homeName) || isFcsHeuristic(g.awayName),
      closeCacheLoaded: Boolean(closePayload),
      earlyCacheLoaded: Boolean(earlyPayload),
      closeEventCount: closeEvents.length,
      earlyEventCount: earlyEvents.length,
      closeStrictMatch: Boolean(closeStrict),
      earlyStrictMatch: Boolean(earlyStrict),
      closeAliasRecover: closeTwoSidedRecover,
      earlyAliasRecover: earlyTwoSidedRecover,
      twoSidedDiag,
      nearestOddsNames,
      earlyAlsoMissing: earlyMissingIds.has(m.eventId),
    });
  }

  // Recompute true absent vs alias-only using audits
  const aliasRecoverableClose = missingAudits.filter(
    (a) =>
      a.closeAliasRecover &&
      (a.closeAliasRecover as { mlHome: number | null; mlAway: number | null }).mlHome != null &&
      (a.closeAliasRecover as { mlHome: number | null; mlAway: number | null }).mlAway != null,
  );
  const trulyAbsentClose = missingAudits.filter(
    (a) => a.pullerReason === "no_odds_match" && !a.closeAliasRecover && a.closeCacheLoaded,
  );
  const twoSidedOnly = missingAudits.filter((a) => a.pullerReason === "missing_two_sided_ml");

  // Systematic patterns
  const byWeek = weekCounts;
  const byReason = Object.fromEntries(
    Object.entries(
      missingAudits.reduce(
        (acc, a) => {
          const k = String(a.pullerReason);
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
    ),
  );
  const schoolTokens = missingAudits.flatMap((a) => [
    schoolKey(String(a.home)),
    schoolKey(String(a.away)),
  ]);
  const tokenCounts: Record<string, number> = {};
  for (const t of schoolTokens) tokenCounts[t] = (tokenCounts[t] || 0) + 1;
  const repeatedSchools = Object.entries(tokenCounts)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  // --- Coverage readiness (no prediction / no Brier) ---
  const decidedClose = closeArch.games.filter(
    (g) => g.homeScore != null && g.awayScore != null && g.homeScore !== g.awayScore && g.mlHome != null,
  );
  const pairedDecided = pairedIds.filter((id) => {
    const c = closeById.get(id)!;
    return (
      c.homeScore != null &&
      c.awayScore != null &&
      c.homeScore !== c.awayScore &&
      c.mlHome != null &&
      c.mlAway != null &&
      earlyById.get(id)?.mlHome != null &&
      earlyById.get(id)?.mlAway != null
    );
  });

  const m1Ready = decidedClose.length >= 200;
  // M2–M4 require predictions — coverage-only readiness: enough decided close ML rows
  const mCoverage = {
    M1: {
      criterion: "n ≥ 200 decided games with close ML",
      nDecidedWithCloseMl: decidedClose.length,
      threshold: 200,
      coverageReady: m1Ready,
      note: "Sample size only — Brier/bias not computed (no scoring)",
    },
    M2: {
      criterion: "brierEngine < 0.25",
      coverageReady: m1Ready,
      note: "Needs engine probs — NOT scored this turn; sample appears adequate if M1 holds",
    },
    M3: {
      criterion: "brierEngine ≤ brierMarketClose + 0.02",
      nWithCloseTwoSidedMl: closeTwoSided,
      coverageReady: closeTwoSided >= 200,
      note: "Market close ML present on matched archive; not scored",
    },
    M4: {
      criterion: "|meanP − meanY| ≤ 0.08",
      coverageReady: m1Ready,
      note: "Needs engine probs — NOT scored this turn",
    },
  };

  // C1–C6: need early+close same-side pairs for CLV; away needs early two-sided (R2)
  const cCoverage = {
    C1: {
      criterion: "nMlWithClv ≥ 50",
      pairedTwoSidedEarlyClose: pairedTwoSided,
      threshold: 50,
      coverageReady: pairedTwoSided >= 50,
      note: "Upper bound on selectable CLV rows before edge/R3 filters; selections not formed this turn",
    },
    C2: {
      criterion: "meanClvProbPoints ≥ 0",
      coverageReady: pairedTwoSided >= 50,
      note: "Not computed — price deltas / CLV not inspected for retune; coverage only",
    },
    C3: {
      criterion: "pctSelectionsBeatClose ≥ 0.45",
      coverageReady: pairedTwoSided >= 50,
      note: "Not computed this turn",
    },
    C4: {
      criterion: "homeSelections ≥ 20 and awaySelections ≥ 20",
      earlyTwoSidedRows: earlyTwoSided,
      awaySelectableUpperBound: earlyTwoSided,
      coverageReady: earlyTwoSided >= 20 && closeTwoSided >= 20,
      note: "R2: away ML requires early two-sided cache — cache now populated; actual mix depends on selection",
    },
    C5: {
      criterion: "soft gates PASS_SOFT_GATES_ONLY or better on same stamp",
      coverageReady: null as boolean | null,
      note: "Requires engine soft-gate run — not executed (no scoring)",
    },
    C6: {
      criterion: "PASS label only if C1–C5",
      coverageReady: false,
      note: "No PASS label without scoring; coverage prep only",
    },
  };

  const systematic =
    byReason.no_odds_match >= 30 ||
    aliasRecoverableClose.length >= 5 ||
    fcsMissing >= 5 ||
    Object.values(byWeek).some((n) => n >= 8);

  const systematicVerdict = {
    isSystematic: systematic,
    primaryDrivers: [
      byReason.no_odds_match
        ? `${byReason.no_odds_match}/44 puller no_odds_match (join/alias or absent from Odds slate)`
        : null,
      `${aliasRecoverableClose.length}/44 recoverable via alias/loose join on cached close slate (cache-only rematch possible)`,
      `${trulyAbsentClose.length}/44 no recoverable join on cached close events (likely not on Odds NCAAF slate / naming gap beyond alias map)`,
      `${twoSidedOnly.length}/44 missing_two_sided_ml`,
      fcsMissing ? `${fcsMissing}/44 FCS-name heuristic hit (membership still FBS-scoped; heuristic only)` : null,
      `Week concentration: ${JSON.stringify(byWeek)}`,
    ].filter(Boolean),
    interpretation:
      aliasRecoverableClose.length >= 30
        ? "Missingness is systematic: nearly all no_odds_match rows are ESPN↔Odds naming aliases (State/UMass/Appalachian/José/Hawaii/Southern Miss/apostrophe) recoverable from the same cached snapshots. The remaining missing_two_sided_ml rows are events present with zero bookmakers (empty price shell) — not credit-cap truncation."
        : aliasRecoverableClose.length > 0
          ? "Missingness is partly systematic alias/join failure (same pattern as TUNING), not random credit-cap truncation."
          : "Missingness is dominated by events absent from Odds snapshots or unjoinable names; not credit-cap driven.",
  };

  const scoringReadiness = {
    paidRetrieval: false,
    finalEvalScored: false,
    deployOta: false,
    ncaafUnlock: false,
    membershipFrozen: true,
    membershipN: membership.games.length,
    modelFrozen: true,
    selectionRulesFrozen: "R1–R4 / C1–C6 unchanged — not reopened",
    spreadsBlocked: true,
    archivesScoredFlag: {
      close: closeArch.scored === false,
      early: earlyArch.scored === false,
    },
    pairing: {
      closeMatched: closeIds.size,
      earlyMatched: earlyIds.size,
      pairedSameGameId: pairedIds.length,
      closeOnly: closeOnly.length,
      earlyOnly: earlyOnly.length,
      missingIdsIdentical: missingEqual,
      pairedTwoSided: pairedTwoSided,
    },
    timingRules: {
      closeSnapshotBeforeCommence: {
        ok: timing.closePreCommenceOk,
        fail: timing.closePreCommenceFail,
        missingFields: timing.closeMissingCommenceOrSnap,
        pass: timing.closePreCommenceFail === 0,
      },
      earlyAsOfNearT24h: {
        windowHours: "20–28h before kickoff (inclusive audit band around locked T−24h)",
        ...earlyHoursSummary,
        insideBand: timing.earlyOk20to28h,
        outsideBand: timing.earlyOutside20to28h,
        pass: timing.earlyOutside20to28h === 0 && (earlyHoursSummary?.n || 0) > 0,
      },
      closeRequestDateKickoffMinute: {
        ok: timing.requestDateEqualsKickoffMinute,
        mismatch: timing.requestDateMismatch,
      },
    },
    missingAudit: {
      n: closeArch.missing.length,
      reasons: byReason,
      byWeek,
      fcsNameHeuristicHits: fcsMissing,
      aliasRecoverableTwoSidedClose: aliasRecoverableClose.length,
      trulyUnjoinedOnCachedCloseSlate: trulyAbsentClose.length,
      twoSidedPullerFails: twoSidedOnly.length,
      repeatedSchools,
      systematicVerdict,
      // do not dump all 44 into md; full list in JSON
    },
    coverageReadiness: {
      moneylineM1M4: mCoverage,
      coachClvC1C6: cCoverage,
      verdict:
        m1Ready && pairedTwoSided >= 50
          ? "COVERAGE_READY_FOR_SCORING_ATTEMPT — sample thresholds for M1 and C1 upper-bound are met on paired archives; do not score until alias-missing policy accepted"
          : "NOT_COVERAGE_READY",
    },
    recommendation: {
      scoreNow: false,
      reason:
        "Cache-only audit complete. Matched paired coverage is adequate for M1 sample and C1 upper-bound, but 44 missing (mostly joins) should be policy-accepted or alias-rematched from cache before any FINAL_EVAL score. No paid HTTP. No scoring this turn.",
      nextAllowed: [
        "Optional cache-only alias rematch of recoverable misses (no Odds HTTP)",
        "Human accept MISSING_DATA for unrecoverable slate absences",
        "Then authorize FINAL_EVAL scoring separately",
      ],
      forbidden: ["paid Odds requests", "scoring", "deploy", "OTA", "NCAAF unlock", "edit C1–C6 / model / membership"],
    },
  };

  const report = {
    generatedAt: new Date().toISOString(),
    paidHttp: 0,
    predictionInspection: false,
    finalEvalScored: false,
    cacheOnly: true,
    closeCacheFiles: existsSync(CLOSE_CACHE) ? readdirSync(CLOSE_CACHE).length : 0,
    earlyCacheFiles: existsSync(EARLY_CACHE) ? readdirSync(EARLY_CACHE).length : 0,
    scoringReadiness,
    missingAudits,
  };

  const md = `# FINAL_EVAL scoring-readiness report (cache-only)

**Paid HTTP:** 0 · **Scored:** false · **Deploy/OTA/unlock:** false  
**Membership / model / R1–R4 / C1–C6:** preserved (not edited)  
**Prediction inspection:** none

## Pairing (close ↔ early)

| Check | Result |
|-------|--------|
| Close matched | ${closeIds.size} |
| Early matched | ${earlyIds.size} |
| Paired on same \`gameId\` | **${pairedIds.length}** |
| Close-only / early-only | ${closeOnly.length} / ${earlyOnly.length} |
| Missing ID sets identical | **${missingEqual}** |
| Paired two-sided (home+away ML both archives) | **${pairedTwoSided}** |

## Locked timing rules

| Rule | Result |
|------|--------|
| Close \`snapshotTimestamp\` < Odds \`commence_time\` | **${timing.closePreCommenceOk}** ok / ${timing.closePreCommenceFail} fail |
| Early snap ~T−24h (audit band 20–28h) | **${timing.earlyOk20to28h}** inside / ${timing.earlyOutside20to28h} outside · mean=${earlyHoursSummary ? earlyHoursSummary.mean.toFixed(2) : "n/a"}h |
| Close requestDate = kickoff UTC minute | ${timing.requestDateEqualsKickoffMinute} ok / ${timing.requestDateMismatch} mismatch |

## Missingness audit (n=${closeArch.missing.length}, cache-only)

| Puller reason | n |
|---------------|--:|
${Object.entries(byReason)
  .map(([k, v]) => `| ${k} | ${v} |`)
  .join("\n")}

| Cache rematch probe | n |
|---------------------|--:|
| Alias/unicode two-sided recoverable (close) | **${aliasRecoverableClose.length}** |
| No join on cached close slate | **${trulyAbsentClose.length}** |
| \`missing_two_sided_ml\` (event found, empty books) | **${twoSidedOnly.length}** |
| FCS-name heuristic hits | ${fcsMissing} |

**Systematic?** **${systematicVerdict.isSystematic}** — ${systematicVerdict.interpretation}

Drivers:
${systematicVerdict.primaryDrivers.map((d) => `- ${d}`).join("\n")}

Repeated school tokens (≥2): ${repeatedSchools.map(([t, n]) => `${t}(${n})`).join(", ") || "none"}

## Coverage readiness (no scores)

### M1–M4 (moneyline)
| # | Criterion | Coverage ready | Evidence |
|---|-----------|:--------------:|----------|
| M1 | n≥200 decided + close ML | **${mCoverage.M1.coverageReady}** | n=${decidedClose.length} |
| M2 | brier &lt; 0.25 | sample ok / unscored | needs engine |
| M3 | ≤ market+0.02 | **${mCoverage.M3.coverageReady}** | two-sided close ML=${closeTwoSided} |
| M4 | \|bias\|≤0.08 | sample ok / unscored | needs engine |

### C1–C6 (Coach ML CLV)
| # | Criterion | Coverage ready | Evidence |
|---|-----------|:--------------:|----------|
| C1 | nMlWithClv≥50 | **${cCoverage.C1.coverageReady}** | paired two-sided upper bound=${pairedTwoSided} |
| C2 | meanClv≥0 | not computed | deltas not inspected |
| C3 | beat-close≥0.45 | not computed | — |
| C4 | home/away≥20 | **${cCoverage.C4.coverageReady}** | early two-sided=${earlyTwoSided} (R2 away path open) |
| C5 | soft gates | not run | — |
| C6 | PASS label | **false** | no scoring |

**Coverage verdict:** ${scoringReadiness.coverageReadiness.verdict}

## Recommendation

- **Score now:** **false**
- ${scoringReadiness.recommendation.reason}
- Next: cache-only alias rematch and/or accept MISSING_DATA — then separate scoring authorization
- Forbidden this turn: paid Odds · scoring · deploy · OTA · NCAAF unlock · lock edits

## Repro
\`\`\`bash
cd artifacts/api-server
node --import ./test/register-hooks.mjs ./scripts/ncaafFinalEvalMissingCacheAudit.ts
\`\`\`
`;

  mkdirSync(ART, { recursive: true });
  writeFileSync(join(ART, "ncaaf-final-eval-scoring-readiness.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(ART, "ncaaf-final-eval-scoring-readiness.md"), md);
  writeFileSync(join(FIX, "ncaaf-final-eval-scoring-readiness.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(FIX, "ncaaf-final-eval-scoring-readiness.md"), md);
  writeFileSync(join(DOCS, "ncaaf-final-eval-scoring-readiness.md"), md);

  console.log(
    JSON.stringify(
      {
        paired: pairedIds.length,
        missing: closeArch.missing.length,
        aliasRecoverableClose: aliasRecoverableClose.length,
        trulyAbsentClose: trulyAbsentClose.length,
        systematic: systematicVerdict.isSystematic,
        m1n: decidedClose.length,
        pairedTwoSided,
        verdict: scoringReadiness.coverageReadiness.verdict,
        scoreNow: false,
      },
      null,
      2,
    ),
  );
  console.log("Wrote scoring-readiness report (cache-only, unscored)");
}

main();
