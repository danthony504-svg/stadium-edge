// The chat system prompt tells the model to end betting replies with a one-line
// responsible-gambling reminder ("Bet responsibly — no wager is ever
// guaranteed.", "Bet only what you're comfortable losing.", etc.). That sign-off
// is suppressed at the DISPLAY layer (the web app strips it too). On mobile it
// otherwise rendered as a dangling full-width sentence below the reply.
//
// Matcher is intentionally disclaimer-SHAPED, not broad: every alternative is
// anchored to betting/responsible-gambling phrasing so a legitimate trailing
// analysis line (e.g. "He's averaging 21+ points", "there's no guarantee he
// plays") is NOT mistaken for the sign-off. Combined with the short-line guard
// in stripTrailingReminder, false positives on real content are very unlikely.
export const REMINDER_RE =
  /(?:bet|wager|gambl\w*)\s+responsibl|responsible\s+(?:bet|wager|gambl)|gambling\s+problem|call\s+1-?800|no\s+(?:wager|bet|outcome|pick|parlay)\s+is\s+(?:ever\s+)?guarantee|nothing\s+is\s+(?:ever\s+)?guarantee|comfortable\s+losing|(?:bet|wager|risk)\s+only\s+what\s+you|only\s+(?:bet|wager|risk)\s+what\s+you|what\s+you\s+can\s+afford\s+to\s+lose/i;

// A real sign-off is a short closing sentence; an analytical bullet/paragraph
// that merely contains a matching fragment is long. Only strip short tail lines.
const MAX_REMINDER_LEN = 140;

// Drop trailing blank + responsible-gambling reminder line(s) from a reply.
// Trims from the END only so mid-reply text is never touched.
export function stripTrailingReminder(text: string): string {
  const lines = text.split("\n");
  while (lines.length) {
    const last = lines[lines.length - 1].trim();
    if (last === "" || (last.length <= MAX_REMINDER_LEN && REMINDER_RE.test(last))) {
      lines.pop();
      continue;
    }
    break;
  }
  return lines.join("\n").trim();
}
