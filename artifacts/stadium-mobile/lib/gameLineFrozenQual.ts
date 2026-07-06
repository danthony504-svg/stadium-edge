// Frozen game-line qualification — no imports from parlayQualifiedGate (avoids cycles).

import type { ParsedPick } from "../components/PickCard.tsx";
import { gradeRank } from "./finalAiScore.ts";

const MIN_GRADE = "C+";
const MIN_CONFIDENCE = 50;

/** True when gameLineFinal.display has every metric surfaces must show — no placeholders. */
export function gameLineFrozenMetricsComplete(pick: ParsedPick): boolean {
  if (!pick.gameLineFrozen || pick.gameLineFinal?.frozenAt == null) return false;
  const d = pick.gameLineFinal.display;
  if (!d) return false;
  if (!d.grade || gradeRank(d.grade) < gradeRank(MIN_GRADE)) return false;
  if (d.confidencePct == null || !Number.isFinite(d.confidencePct) || d.confidencePct < MIN_CONFIDENCE) {
    return false;
  }
  if (d.edgePct == null || !Number.isFinite(d.edgePct) || d.edgePct <= 0) return false;
  if (d.simHit == null || !Number.isFinite(d.simHit)) return false;
  if (d.simPct == null || !Number.isFinite(d.simPct)) return false;
  if (!d.pick?.trim() || !d.market?.trim() || !d.game?.trim()) return false;
  return true;
}
