import type { ParsedPick } from "@/components/PickCard";

/** True when deep sim materially changed a leg's line or composite grade. */
export function coachTicketUpgraded(before: ParsedPick[], after: ParsedPick[]): boolean {
  if (after.length !== before.length) return true;
  for (let i = 0; i < after.length; i++) {
    const a = after[i]!;
    const b = before[i]!;
    if (a.pick !== b.pick || a.odds !== b.odds || a.market !== b.market) return true;
    const ac = a.finalAiScore?.composite ?? a.scores?.composite ?? 0;
    const bc = b.finalAiScore?.composite ?? b.scores?.composite ?? 0;
    if (ac > bc + 0.25) return true;
  }
  return false;
}
