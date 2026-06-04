// Odds / parlay math — American odds throughout, matching the web app.

export function formatAmerican(odds: number | null | undefined): string {
  if (odds == null || !Number.isFinite(odds)) return "—";
  const n = Math.round(odds);
  return n > 0 ? `+${n}` : `${n}`;
}

// Format a game's ISO start time as a short local date + time for pick cards,
// e.g. "Today 7:05 PM", "Tomorrow 1:00 PM", "Sat 1:00 PM", "Jun 12 7:05 PM".
// Returns "" when the timestamp is missing or unparseable so the card simply
// omits the line rather than showing a broken date.
export function formatGameTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return "";
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
  let day: string;
  if (dayDiff === 0) day = "Today";
  else if (dayDiff === 1) day = "Tomorrow";
  else if (dayDiff > 1 && dayDiff < 7)
    day = d.toLocaleDateString(undefined, { weekday: "short" });
  else day = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${day} ${time}`;
}

// American odds -> decimal multiplier (e.g. -110 -> 1.909, +150 -> 2.5).
export function americanToDecimal(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return 1;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

// Decimal multiplier -> American odds.
export function decimalToAmerican(dec: number): number {
  if (!Number.isFinite(dec) || dec <= 1) return 0;
  return dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
}

// Implied probability (0..1) for a single American price.
export function impliedProb(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return 0;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

// Combined American odds of a parlay (multiply the decimal legs).
export function parlayAmerican(legOdds: number[]): number | null {
  const valid = legOdds.filter((o) => Number.isFinite(o) && o !== 0);
  if (valid.length === 0) return null;
  const dec = valid.reduce((acc, o) => acc * americanToDecimal(o), 1);
  return decimalToAmerican(dec);
}

// Combined implied probability of the whole parlay (0..1).
export function parlayImplied(legOdds: number[]): number {
  const valid = legOdds.filter((o) => Number.isFinite(o) && o !== 0);
  if (valid.length === 0) return 0;
  return valid.reduce((acc, o) => acc * impliedProb(o), 1);
}

// Total return (stake + winnings) for a stake on combined American odds.
export function payout(stake: number, combinedAmerican: number | null): number {
  if (combinedAmerican == null || !Number.isFinite(stake) || stake <= 0) return 0;
  return stake * americanToDecimal(combinedAmerican);
}

// Parse an American odds token out of an AI PICK line field (e.g. "+120", "-140").
export function parseOdds(token: string): number | null {
  if (!token) return null;
  const m = token.replace(/[−–—]/g, "-").match(/[+-]?\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
}

// An odds-threshold request ("all -300 or less", "every leg +300 or more").
// `signed` is the American-odds bound (e.g. -300, +300). `mode` is the
// direction the user wants EVERY leg to satisfy:
//   atLeast → odds >= signed  (longer/bigger payouts; "+300 or more")
//   atMost  → odds <= signed  (shorter/heavier favorites; "-300 or less")
export type OddsThreshold = { signed: number; mode: "atLeast" | "atMost" };

// Detect an odds-threshold bound in free text. Requires both an odds-sized
// number (|n| >= 100, which also rules out leg counts like "10 leg") AND an
// explicit comparator ("or more"/"or less"/…) so a bare price mention never
// trips it. Returns the LAST bound found (the request's operative one) or null.
export function parseOddsThreshold(text: string | null | undefined): OddsThreshold | null {
  const t = String(text || "").toLowerCase().replace(/[−–—]/g, "-");
  const re = /(^|[^\w.])(\+|-|plus\s+|minus\s+)?(\d{3,4})(\s*\+)?/g;
  let m: RegExpExecArray | null;
  let best: OddsThreshold | null = null;
  while ((m = re.exec(t)) !== null) {
    const num = parseInt(m[3], 10);
    if (num < 100) continue;
    const signTok = (m[2] || "").trim();
    const trailingPlus = !!m[4];
    const sign = signTok === "-" || signTok === "minus" ? -1 : 1;
    const tail = t.slice(m.index + m[0].length, m.index + m[0].length + 28);
    const head = t.slice(Math.max(0, m.index - 24), m.index);
    let mode: "atLeast" | "atMost" | null = null;
    if (
      /\b(?:or|and)?\s*(?:more|higher|longer|better|greater|bigger|over|up|plus)\b/.test(tail) ||
      /\b(?:at\s+least|minimum|min|no\s+less\s+than)\b/.test(head)
    ) mode = "atLeast";
    else if (
      /\b(?:or|and)?\s*(?:less|lower|shorter|fewer|under|heavier|down)\b/.test(tail) ||
      /\b(?:at\s+most|maximum|max|no\s+more\s+than|up\s+to)\b/.test(head)
    ) mode = "atMost";
    if (!mode && trailingPlus) mode = "atLeast";
    if (!mode) continue;
    // Require an explicit odds cue — a sign token, a "bare" trailing "+" (not
    // "300+ yards"), or an odds/price word nearby — so a non-odds numeric ask
    // with a comparator ("at least 100 yards", "300+ passing yards") never
    // registers as a price bound and silently filters real legs.
    const hasOddsCue =
      !!signTok ||
      (trailingPlus && !/^\s*[a-z]/.test(tail)) ||
      /\b(?:odds|prices?|lines?|juice|vig|payouts?|american|moneyline)\b/.test(head + " " + tail);
    if (!hasOddsCue) continue;
    best = { signed: sign * num, mode };
  }
  return best;
}

// Does a single leg's American price satisfy the bound? A null/NaN price (e.g.
// a PrizePicks DFS leg with no American odds) CANNOT be verified against an
// odds bound, so it is excluded under a strict threshold.
export function oddsSatisfiesThreshold(
  odds: number | null | undefined,
  thr: OddsThreshold | null,
): boolean {
  if (!thr) return true;
  if (odds == null || !Number.isFinite(odds)) return false;
  return thr.mode === "atLeast" ? odds >= thr.signed : odds <= thr.signed;
}

// Does the request want game-level PERIOD markets (1H/2H/Q1–Q4) or a same-game
// parlay? Those legs are heavy, so the chat context only surfaces them when the
// user explicitly asks (mirrors the web app's includePeriods gate). Matches the
// raw suffixes ("2H", "Q3"), the spelled-out forms ("second half", "first
// quarter"), the bare period words, and same-game/SGP intent.
export function wantsPeriodMarkets(text: string | null | undefined): boolean {
  const t = String(text || "").toLowerCase();
  if (/\b(1h|2h|h1|h2|q1|q2|q3|q4)\b/.test(t)) return true;
  if (/\b(first|second|third|fourth|1st|2nd|3rd|4th)\s+(half|quarter)\b/.test(t)) return true;
  if (/\b(half|halves|quarter|quarters|period)\b/.test(t)) return true;
  if (/\bsame[-\s]?game\b/.test(t) || /\bsgp\b/.test(t)) return true;
  return false;
}
