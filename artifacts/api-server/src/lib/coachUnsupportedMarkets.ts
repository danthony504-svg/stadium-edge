/** Soccer card/booking asks — no feed; mirror stadium-mobile/lib/unsupportedCoachMarkets.ts */

const SOCCER_DISCIPLINE_RE =
  /\b(?:yellow cards?|red cards?|bookings?|to be booked|get(?:ting)?\s+booked|carded|sent off|discipline props?)\b/i;

const MATCHUP_SEP = "(?:v\\.?|vs\\.?|versus|@|\\bx\\b)";
const MATCHUP_TAIL_RE = /\s+(?:tonight|today|tomorrow|this\s+weekend)\b.*$/i;

function trimMatchupTail(s: string): string {
  return s.replace(MATCHUP_TAIL_RE, "").trim();
}

export function isUnsupportedSoccerDisciplineAsk(text?: string | null): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (!SOCCER_DISCIPLINE_RE.test(t)) return false;
  if (/\b(?:build|make|give me)\b/i.test(t) && /\b(?:parlay|ticket|slip|\d+\s*[-\s]?leg)\b/i.test(t))
    return false;
  return true;
}

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
    `${gameLead}the soccer player props we **do** have posted (when books list them) are **shots**, **shots on target**, and **anytime goal scorer** — those come from the live board. Card markets aren't on it.`,
    "If you're betting foul trouble manually, check the confirmed starting XIs and the referee assignment. I won't name players without historical card data in the feed.",
  ].join("\n\n");
}
