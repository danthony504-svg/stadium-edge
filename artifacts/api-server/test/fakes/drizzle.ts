// Test stub for drizzle-orm's condition builders. coachBuild.ts imports these
// only to build WHERE/ON-CONFLICT clauses; the fake db (./db.ts) ignores the
// returned condition objects and dispatches purely on the table identity, so a
// no-op stub is enough and keeps the real (column-introspecting) drizzle
// builders from choking on the fake table sentinels.
export const and = (..._args: unknown[]) => ({});
export const eq = (..._args: unknown[]) => ({});
export const inArray = (..._args: unknown[]) => ({});
export const lt = (..._args: unknown[]) => ({});
export const like = (..._args: unknown[]) => ({});
export const or = (..._args: unknown[]) => ({});
export const sql = (..._args: unknown[]) => ({});
