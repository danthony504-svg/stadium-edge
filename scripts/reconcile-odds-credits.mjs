// Input contains two observations of the same production key and usage period.
export function reconcileOddsCredits({ start, end, rows, windowStartAt = start.at }) {
  const from = Date.parse(start.at), to = Date.parse(end.at);
  const expectedStart = Date.parse(windowStartAt);
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(expectedStart) ||
      expectedStart > from || from >= to ||
      start.at.slice(0, 7) !== end.at.slice(0, 7) ||
      !Number.isSafeInteger(start.used) || !Number.isSafeInteger(end.used) ||
      start.used < 0 || end.used < start.used) throw new Error("Invalid quota comparison window");
  const byCaller = { unattributed: 0 };
  let missingCost = 0;
  for (const row of rows) {
    const at = Date.parse(row.at);
    if (row.keyTier !== "production" || !(at > from && at <= to)) continue;
    if (!Number.isSafeInteger(row.cost) || row.cost < 0) { missingCost++; continue; }
    const caller = ["scheduled_refresh", "coach_build", "first_basket_collection", "admin_test", "live_probe", "app_browse"]
      .includes(row.caller) ? row.caller : "unattributed";
    byCaller[caller] = (byCaller[caller] ?? 0) + row.cost;
  }
  const logged = Object.values(byCaller).reduce((sum, value) => sum + value, 0);
  const dashboard = end.used - start.used;
  const gap = dashboard - logged;
  const uncoveredInterval = from > expectedStart
    ? { start: windowStartAt, end: start.at }
    : null;
  const threshold = Math.max(100, dashboard * 0.05);
  return { windowStartAt, coverageComplete: uncoveredInterval === null, uncoveredInterval, threshold, start: start.at, end: end.at, dashboard, logged, byCaller, missingCost, gap,
    unattributedGap: Math.max(0, gap), requiresReview: uncoveredInterval !== null || Math.abs(gap) > threshold };
}
