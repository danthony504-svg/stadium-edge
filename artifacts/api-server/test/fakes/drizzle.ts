// Test stub for drizzle-orm's condition builders. The real builders introspect
// real columns and would choke on the fake table sentinels in ./db.ts, so they
// stay stubbed. But unlike a pure no-op, these capture a small STRUCTURED node
// describing the predicate (operator + column + value). The fake db (./db.ts)
// uses those nodes to dispatch a SELECT to the right canned rows (markers vs
// stash vs notifPrefs all live on user_sync) and to actually EVALUATE the
// DELETE predicates the cron pruner builds (age cutoff + dedupe-key scoping) —
// which a condition-blind no-op fake could never exercise. The columns are the
// plain string sentinels from ./db.ts (e.g. `userSyncTable.namespace ===
// "namespace"`), so a node is just `{ t, a, b }`.
export const eq = (a: unknown, b: unknown) => ({ t: "eq", a, b }) as const;
export const lt = (a: unknown, b: unknown) => ({ t: "lt", a, b }) as const;
export const like = (a: unknown, b: unknown) => ({ t: "like", a, b }) as const;
export const inArray = (a: unknown, b: unknown) => ({ t: "inArray", a, b }) as const;
export const and = (...parts: unknown[]) => ({ t: "and", parts }) as const;
export const or = (...parts: unknown[]) => ({ t: "or", parts }) as const;
// Tagged-template form, used only for the `data ->> 'buildId' = $val` marker
// match. Capture the interpolated values so the fake can read the buildId.
export const sql = (strings: TemplateStringsArray, ...values: unknown[]) =>
  ({ t: "sql", strings: Array.from(strings), values }) as const;
