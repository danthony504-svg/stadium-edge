/** Pure anchor placement: never cover the control being taught. */
export type TutorialFrame = { x: number; y: number; width: number; height: number };
export type TourPlacement = { top: number; direction: "above" | "below" };
export function placeTourTooltip(frame: TutorialFrame | null, screenHeight: number, cardHeight = 285): TourPlacement | null {
  if (!frame || !Number.isFinite(screenHeight) || screenHeight <= 0 ||
      !Number.isFinite(frame.y) || frame.y < 0 ||
      frame.height <= 0 || frame.y >= screenHeight) return null;
  const gap = 16;
  const edge = 12;
  const below = frame.y + frame.height + gap;
  if (below + cardHeight <= screenHeight - edge) return { top: below, direction: "below" };
  const above = frame.y - gap - cardHeight;
  if (above >= edge) return { top: above, direction: "above" };
  return null;
}
