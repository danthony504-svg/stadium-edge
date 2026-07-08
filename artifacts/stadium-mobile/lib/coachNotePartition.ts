/** Classify Coach leg-note paragraphs so optimizer prose stays collapsed. */

const OPTIMIZER_RE =
  /after the 10k sim|built from player props|chalk moneyline scaffold|highest final ai score|longshot parlays are built from player props|cleared \d+ chalk game line/i;

const SHORTFALL_RE =
  /asked for \d+ legs|tickets cap at|held up against|almost qualified/i;

export function isOptimizerCoachParagraph(text: string): boolean {
  return OPTIMIZER_RE.test(text);
}

export function isShortfallCoachParagraph(text: string): boolean {
  return SHORTFALL_RE.test(text);
}

export function partitionCoachNotes(legNote?: string, coachDetailNote?: string) {
  const storedDetail = coachDetailNote?.trim() ?? "";
  const leg = legNote?.trim() ?? "";
  if (!leg) {
    return { shortfall: "", detail: storedDetail };
  }

  const paragraphs = leg.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const shortfallParts: string[] = [];
  const detailParts: string[] = [];

  for (const p of paragraphs) {
    if (isOptimizerCoachParagraph(p)) {
      detailParts.push(p);
    } else if (isShortfallCoachParagraph(p)) {
      shortfallParts.push(p);
    } else {
      // ML lean, props-only, tonight notes — collapsed with optimizer detail.
      detailParts.push(p);
    }
  }

  // Whole-block fallback for legacy single-blob legNote.
  if (!storedDetail && detailParts.length === 0 && isOptimizerCoachParagraph(leg)) {
    detailParts.push(leg);
  }

  const detail = storedDetail || detailParts.join("\n\n");
  const shortfall = shortfallParts.join("\n\n");

  return { shortfall, detail };
}
