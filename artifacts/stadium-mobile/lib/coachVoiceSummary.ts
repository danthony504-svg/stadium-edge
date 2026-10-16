/**
 * Energetic sports-analyst spoken summary from a Coach reply.
 * Pure text transform — no network / native deps (node:test safe).
 */

const MAX_SPOKEN_CHARS = 420;

/** Strip PICK: card lines and markdown noise for speech. */
export function stripCoachReplyForSpeech(raw: string): string {
  const lines = String(raw ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^PICK:\s*/i.test(l))
    .filter((l) => !/^ALT:\s*/i.test(l))
    .filter((l) => l !== "---")
    .map((l) =>
      l
        .replace(/^\*\s+/, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/^#+\s*/, ""),
    );
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Build a short, high-energy analyst read-aloud from the Coach result.
 * Honest: does not invent picks; only reframes existing prose.
 */
export function buildEnergeticAnalystSummary(
  coachReply: string,
  opts?: { pickCount?: number | null },
): string {
  const body = stripCoachReplyForSpeech(coachReply);
  if (!body) {
    const n = opts?.pickCount;
    if (n != null && n > 0) {
      return `Alright, ticket's locked — ${n} solid ${n === 1 ? "leg" : "legs"} on the board. Check the cards for the details, and let's ride.`;
    }
    return "I've got the board read for you — check the Coach reply for the full breakdown.";
  }

  let spoken = body;
  if (spoken.length > MAX_SPOKEN_CHARS) {
    spoken = spoken.slice(0, MAX_SPOKEN_CHARS - 1).replace(/\s+\S*$/, "") + "…";
  }

  const opener =
    opts?.pickCount && opts.pickCount > 0
      ? `Let's go — ${opts.pickCount}-leg read coming in hot. `
      : "Here's the sharp take. ";

  return `${opener}${spoken}`;
}
