import type { ParsedPick } from "../components/PickCard.tsx";
import { pickLegFingerprint } from "./parlayReachCore.ts";

/** Keep visible preview cards stable; new partials may append but never replace them. */
export function appendProgressiveCoachPreview(
  visible: readonly ParsedPick[],
  incoming: readonly ParsedPick[],
  target: number,
): ParsedPick[] {
  const result = [...visible];
  let changed = false;
  const seen = new Set(result.map(pickLegFingerprint));
  for (const pick of incoming) {
    if (result.length >= target || seen.has(pickLegFingerprint(pick))) continue;
    seen.add(pickLegFingerprint(pick));
    result.push(pick);
    changed = true;
  }
  return changed ? result : visible as ParsedPick[];
}
