// ----------------------------------------------------------------------------
// Baseball Savant (Statcast) pitcher batted-ball-against feed — REAL DATA ONLY.
//
// Savant publishes a public "exit velocity & barrels" leaderboard with a CSV
// export. For type=pitcher the rows describe what hitters did AGAINST that
// pitcher, which is exactly the "allowed" profile we want:
//   - brl_percent   -> Barrel% allowed (barrels / batted-ball events)
//   - ev95percent   -> Hard-Hit% allowed (share of batted balls >= 95 mph EV)
//   - attempts      -> batted-ball events (sample size; small samples are noisy)
//
// These two metrics are genuine Statcast numbers ESPN does NOT publish — so they
// unlock the Barrel% / Hard-Hit% factors a HR model needs WITHOUT fabricating.
// We key the map by a normalized pitcher name (diacritic-insensitive) so callers
// that only know the ESPN display name can still join. Fail-closed: any fetch /
// parse error yields an empty map and callers degrade to honest nulls.
// ----------------------------------------------------------------------------

export type PitcherStatcast = {
  barrelPctAllowed: number | null; // %, e.g. 8.4
  hardHitPctAllowed: number | null; // %, e.g. 41.2
  battedBallEvents: number | null; // sample size
  playerId: string | null; // MLBAM id (reference only)
};

// Normalize a name to a join key: strip accents, lowercase, letters only.
// "Sandy Alcántara" and "Alcantara, Sandy" both collapse to "sandyalcantara".
function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

// Minimal RFC-4180-ish CSV line splitter: handles double-quoted fields that may
// themselves contain commas (Savant's "last_name, first_name" column does).
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

const num = (s: string | undefined): number | null => {
  if (s == null) return null;
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

function savantUrl(year: number): string {
  return `https://baseballsavant.mlb.com/leaderboard/statcast?type=pitcher&year=${year}&position=&team=&min=1&csv=true`;
}

async function fetchSavantYear(year: number): Promise<Map<string, PitcherStatcast>> {
  const map = new Map<string, PitcherStatcast>();
  const r = await fetch(savantUrl(year), {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "text/csv" },
  });
  if (!r.ok) throw new Error(`Savant statcast ${year}: ${r.status}`);
  const text = await r.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return map;
  const header = splitCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, "").trim());
  const idx = (name: string) => header.indexOf(name);
  const iName = idx("last_name, first_name");
  const iId = idx("player_id");
  const iAttempts = idx("attempts");
  const iBrl = idx("brl_percent");
  const iHard = idx("ev95percent");
  // Header shape changed -> bail rather than guess at column meaning.
  if (iName < 0 || iBrl < 0 || iHard < 0) return map;
  for (let li = 1; li < lines.length; li++) {
    const cols = splitCsvLine(lines[li]);
    const raw = (cols[iName] ?? "").replace(/^"|"$/g, "").trim();
    if (!raw) continue;
    // "Last, First" -> "First Last"; pass through if already "First Last".
    let display = raw;
    const comma = raw.split(",");
    if (comma.length === 2) display = `${comma[1].trim()} ${comma[0].trim()}`;
    const key = normName(display);
    if (!key) continue;
    map.set(key, {
      barrelPctAllowed: num(cols[iBrl]),
      hardHitPctAllowed: num(cols[iHard]),
      battedBallEvents: iAttempts >= 0 ? num(cols[iAttempts]) : null,
      playerId: iId >= 0 ? (cols[iId] ?? "").replace(/^"|"$/g, "").trim() || null : null,
    });
  }
  return map;
}

const TTL_MS = 6 * 60 * 60 * 1000; // Savant updates roughly daily.
let cache: { at: number; map: Map<string, PitcherStatcast> } | null = null;
let inFlight: Promise<Map<string, PitcherStatcast>> | null = null;

// Load (and cache) the season's pitcher Statcast map. Tries the current season
// first; if that comes back empty (e.g. the very start of a season) it falls
// back to the prior year so the model still has real numbers to work with.
export async function getPitcherStatcastMap(): Promise<Map<string, PitcherStatcast>> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.map;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const year = new Date().getFullYear();
    try {
      let map = await fetchSavantYear(year).catch(() => new Map<string, PitcherStatcast>());
      if (map.size === 0) {
        map = await fetchSavantYear(year - 1).catch(() => new Map<string, PitcherStatcast>());
      }
      // Only overwrite a good cache with a non-empty result; on a transient
      // empty fetch keep serving the last known map.
      if (map.size > 0 || !cache) cache = { at: Date.now(), map };
      return cache.map;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

// Look up one pitcher by display name. Returns null when absent (honest miss).
export function lookupPitcherStatcast(
  map: Map<string, PitcherStatcast>,
  displayName: string | null | undefined,
): PitcherStatcast | null {
  if (!displayName) return null;
  return map.get(normName(displayName)) ?? null;
}
