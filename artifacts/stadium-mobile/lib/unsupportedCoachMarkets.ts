// Honest fast-path replies for Coach asks that name markets we don't carry.

const SOCCER_DISCIPLINE_RE =
  /\b(?:yellow cards?|red cards?|bookings?|to be booked|get(?:ting)?\s+booked|carded|sent off|discipline props?)\b/i;

/** Card/booking asks — no feed for these markets. */
export function isUnsupportedSoccerDisciplineAsk(text?: string | null): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (!SOCCER_DISCIPLINE_RE.test(t)) return false;
  // Parlay-build phrasing with card words is out of scope for this intercept.
  if (/\b(?:build|make|give me)\b/i.test(t) && /\b(?:parlay|ticket|slip|\d+\s*[-\s]?leg)\b/i.test(t))
    return false;
  return true;
}

const MATCHUP_TAIL_RE = /\s+(?:tonight|today|tomorrow|this\s+weekend)\b.*$/i;

function trimMatchupTail(s: string): string {
  return s.replace(MATCHUP_TAIL_RE, "").trim();
}

const MATCHUP_SEP = "(?:v\\.?|vs\\.?|versus|@|\\bx\\b)";

/** Pull a readable matchup hint ("France vs Morocco") when the user named one. */
export function extractMatchupHint(text: string): string | null {
  const t = String(text || "").trim();
  const splitVs = (left: string, right: string) =>
    `${trimMatchupTail(left)} vs ${trimMatchupTail(right)}`;
  const inGame = t.match(/\b(?:in|for)\s+(?:the\s+)?(.+?)\s+game\b/i);
  if (inGame) {
    const inner = trimMatchupTail(inGame[1]!.trim());
    const innerVs = inner.match(new RegExp(`^(.+?)\\s+${MATCHUP_SEP}\\s+(.+)$`, "i"));
    if (innerVs) return splitVs(innerVs[1]!, innerVs[2]!);
    return inner;
  }
  const vs = t.match(
    new RegExp(
      `\\b([\\w.'’-]+(?:\\s+[\\w.'’-]+){0,2})\\s+${MATCHUP_SEP}\\s+([\\w.'’-]+(?:\\s+[\\w.'’-]+){0,2})\\b`,
      "i",
    ),
  );
  if (vs) return splitVs(vs[1]!, vs[2]!);
  return null;
}

export function unsupportedSoccerDisciplineReply(text: string): string {
  const matchup = extractMatchupHint(text);
  const gameLead = matchup ? `For **${matchup}**, ` : "For that match, ";
  return [
    "Stadium Edge doesn't carry **yellow-card / booking** props or per-player card-rate stats, so I can't rank who's most likely to be booked from real feeds.",
    `${gameLead}the soccer player props we **do** have posted (when books list them) are **shots**, **shots on target**, and **anytime / first goal scorer** — those come from the live board. Card markets aren't on it.`,
    "If you're betting foul trouble manually, check the confirmed starting XIs and the referee assignment. I won't name players without historical card data in the feed.",
  ].join("\n\n");
}

const UFC_METHOD_ROUND_RE =
  /\b(?:method of (?:victory|win)|ko\/tko|submission win|fight (?:goes?|to go) the distance|go the distance|winning round|round betting|round \d+\s*(?:winner|win)|by (?:ko|tko|decision|submission))\b/i;

/** UFC method / round / distance markets — Odds API only posts fight winner (h2h). */
export function isUnsupportedUfcMethodRoundAsk(text?: string | null): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (!UFC_METHOD_ROUND_RE.test(t)) return false;
  // Only intercept when the ask is clearly UFC/MMA-scoped.
  if (!/\b(?:ufc|mma|fight(?:er)?s?)\b/i.test(t)) return false;
  return true;
}

export function unsupportedUfcMethodRoundReply(text: string): string {
  const matchup = extractMatchupHint(text);
  const fightLead = matchup ? `For **${matchup}**, ` : "For that fight, ";
  return [
    "Stadium Edge's UFC board is **moneyline-only** from the Odds API — we don't get method-of-victory, go-the-distance, or round-winner markets from the feed, so Coach won't invent those legs.",
    `${fightLead}I can still grade **fight winner** moneylines using real posted prices and fighter context. Method / round props aren't on the board.`,
  ].join("\n\n");
}
