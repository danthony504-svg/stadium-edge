export type CoachLearningPick = { game: string; market: string; selection: string; odds: string };
const PICK_LINE = /^PICK:\s*([^|]+)\|([^|]+)\|([^|]+)\|\s*([+-]?\d+)/gim;

export function parseCoachPicks(text: string): CoachLearningPick[] {
  return Array.from(text.matchAll(PICK_LINE)).map((m) => ({
    game: m[1]!.trim(), market: m[2]!.trim(), selection: m[3]!.trim(), odds: m[4]!.trim(),
  }));
}

export function learningIdentity(pick: CoachLearningPick, sport: string | null, eventId: string | null): string {
  return [sport ?? "unresolved", eventId ?? "unresolved", pick.market, pick.selection]
    .join("|").toLowerCase().replace(/\s+/g, " ").trim();
}
