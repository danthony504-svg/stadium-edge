// In-memory fake of the @workspace/db surface that coachBuild.ts touches. It
// emulates just enough of the drizzle query builder for the functions under test
// (stashAndNotifyBackgroundBuild / stashBackgroundBuildFailure, the cron
// sweepAbandonedCoachBuilds, and the cron pruneOldCoachBuilds).
//
// Two dispatch strategies coexist:
//  - WRITES (insert upserts, at-most-once notif_log claims) dispatch purely on
//    TABLE IDENTITY and are captured for assertions — unchanged from the
//    original harness, so the stash/notify suite keeps passing.
//  - READS / DELETES are PREDICATE-AWARE: three different SELECTs hit user_sync
//    (the marker scan, the per-user terminal-stash lookup, and the notifPrefs
//    lookup), and the cron pruner's safety lives entirely in its DELETE WHERE
//    clauses (age cutoff + dedupe-key scoping). The drizzle fake (./drizzle.ts)
//    captures structured predicate nodes so this fake can route reads to the
//    right canned rows and actually evaluate the pruner's deletes.
//
// Shared with the module under test: the test's resolve hook redirects
// coachBuild.ts's `@workspace/db` import to THIS file, and the test imports it
// directly, so both see the same module instance / __control state.

export const userSyncTable = {
  userId: "userId",
  namespace: "namespace",
  data: "data",
  updatedAt: "updatedAt",
} as const;
export const notifLogTable = {
  userId: "userId",
  dedupeKey: "dedupeKey",
  sentAt: "sentAt",
} as const;
export const pushTokensTable = {
  userId: "userId",
  token: "token",
} as const;

type Row = Record<string, unknown>;

// Namespaces mirrored from coachBuild.ts so the SELECT dispatch can tell the
// marker scan apart from the terminal-stash lookup (both on user_sync).
const COACH_BUILD_NS = "coachBuild";
const COACH_BUILD_PENDING_NS = "coachBuildPending";

export const __control = {
  // Result returned for a SELECT ... FROM userSync WHERE namespace='notifPrefs'.
  // Shape mirrors the real row: `[{ data: { master?, coachReady? } }]`.
  notifPrefsRows: [] as Array<{ data: Row }>,
  // Result returned for a SELECT ... FROM pushTokens.
  tokenRows: [{ token: "tok_1" }] as Array<{ token: string }>,
  // Result returned for the sweeper's marker scan (SELECT ... WHERE
  // namespace='coachBuildPending'). Shape: `{ userId, data, updatedAt }`.
  markerRows: [] as Array<{ userId: string; data: unknown; updatedAt: Date }>,
  // Per-user terminal stash (SELECT ... WHERE userId=? AND namespace='coachBuild'
  // LIMIT 1), keyed by userId. Drives the sweeper's "don't clobber a real
  // outcome" branch.
  stashByUser: {} as Record<string, Row | undefined>,
  // Seeded rows the cron pruner's DELETEs are evaluated against (predicate-aware,
  // so the test can assert WHICH rows are deleted, not just a count).
  coachStashDeleteRows: [] as Row[],
  notifLogDeleteRows: [] as Row[],
  // Captured writes (the upsert payloads) for assertions.
  writes: { userSync: [] as Row[], notifLog: [] as Row[] },
  // Count of DELETEs per table (marker clears / dead-token prunes).
  deletes: { userSync: 0, pushTokens: 0 },
  // Rows the pruner DELETE ... RETURNING actually matched, for scoping asserts.
  deleted: { coachStash: [] as Row[], notifLog: [] as Row[] },
  // The notif_log dedupe ledger — survives across calls within a test so a
  // second call for the same buildId is correctly rejected (at-most-once).
  notifLogKeys: new Set<string>(),
};

export function resetDb(): void {
  __control.notifPrefsRows = [];
  __control.tokenRows = [{ token: "tok_1" }];
  __control.markerRows = [];
  __control.stashByUser = {};
  __control.coachStashDeleteRows = [];
  __control.notifLogDeleteRows = [];
  __control.writes = { userSync: [], notifLog: [] };
  __control.deletes = { userSync: 0, pushTokens: 0 };
  __control.deleted = { coachStash: [], notifLog: [] };
  __control.notifLogKeys = new Set<string>();
}

// ---- predicate evaluation (mirrors ./drizzle.ts node shapes) ----------------

type Cond =
  | { t: "eq" | "lt" | "like" | "inArray"; a: unknown; b: unknown }
  | { t: "and" | "or"; parts: Cond[] }
  | { t: "sql"; strings: string[]; values: unknown[] }
  | Record<string, unknown>;

// Find the value compared via `eq(column, value)` for a given column, anywhere
// in an and/or tree. Used to route user_sync SELECTs/DELETEs by namespace/userId.
function findEqValue(cond: Cond | undefined, field: string): unknown {
  if (!cond || typeof cond !== "object") return undefined;
  const c = cond as { t?: string; a?: unknown; b?: unknown; parts?: Cond[] };
  if (c.t === "eq" && c.a === field) return c.b;
  if ((c.t === "and" || c.t === "or") && Array.isArray(c.parts)) {
    for (const p of c.parts) {
      const v = findEqValue(p, field);
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

function toMs(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "string") return Date.parse(v);
  return NaN;
}

function likeToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^" + escaped.replace(/%/g, ".*").replace(/_/g, ".") + "$");
}

function matchRow(cond: Cond | undefined, row: Row): boolean {
  if (!cond || typeof cond !== "object") return true;
  const c = cond as {
    t?: string;
    a?: unknown;
    b?: unknown;
    parts?: Cond[];
    strings?: string[];
    values?: unknown[];
  };
  switch (c.t) {
    case "eq":
      return row[c.a as string] === c.b;
    case "lt":
      return toMs(row[c.a as string]) < toMs(c.b);
    case "like":
      return likeToRegExp(String(c.b)).test(String(row[c.a as string]));
    case "inArray":
      return Array.isArray(c.b) && c.b.includes(row[c.a as string]);
    case "and":
      return (c.parts ?? []).every((p) => matchRow(p, row));
    case "or":
      return (c.parts ?? []).some((p) => matchRow(p, row));
    case "sql": {
      // Only shape used: `${userSyncTable.data} ->> 'buildId' = ${buildId}`.
      const buildId = c.values?.[c.values.length - 1];
      const data = row.data as Record<string, unknown> | undefined;
      return !!data && data.buildId === buildId;
    }
    default:
      return true;
  }
}

function thenable(rows: unknown) {
  // Awaitable directly (the pushTokens / marker scans) AND chainable with .limit
  // (the notifPrefs / stash lookups) — both yield the same canned rows.
  return {
    then(resolve: (v: unknown) => void) {
      resolve(rows);
    },
    limit(_n: number) {
      return Promise.resolve(rows);
    },
  };
}

export const db = {
  insert(table: unknown) {
    return {
      values(v: Row) {
        return {
          // userSync stash upsert + pending-marker upsert.
          onConflictDoUpdate(_arg: unknown) {
            if (table === userSyncTable) __control.writes.userSync.push(v);
            return Promise.resolve();
          },
          // notif_log at-most-once claim.
          onConflictDoNothing() {
            return {
              returning(_arg: unknown) {
                const key = String(v.dedupeKey);
                if (__control.notifLogKeys.has(key)) {
                  return Promise.resolve([] as Row[]);
                }
                __control.notifLogKeys.add(key);
                __control.writes.notifLog.push(v);
                return Promise.resolve([{ k: key }]);
              },
            };
          },
        };
      },
    };
  },
  select(_cols?: unknown) {
    return {
      from(table: unknown) {
        return {
          where(cond: unknown) {
            if (table === pushTokensTable) return thenable(__control.tokenRows);
            // user_sync hosts three distinct reads — route by namespace.
            const ns = findEqValue(cond as Cond, "namespace");
            if (ns === COACH_BUILD_PENDING_NS) {
              return thenable(__control.markerRows);
            }
            if (ns === COACH_BUILD_NS) {
              const userId = String(findEqValue(cond as Cond, "userId"));
              const stash = __control.stashByUser[userId];
              return thenable(stash ? [{ data: stash }] : []);
            }
            // notifPrefs lookup (and any other user_sync read).
            return thenable(__control.notifPrefsRows);
          },
        };
      },
    };
  },
  delete(table: unknown) {
    return {
      where(cond: unknown) {
        let matched: Row[] = [];
        if (table === pushTokensTable) {
          __control.deletes.pushTokens++;
        } else if (table === notifLogTable) {
          // Cron pruner: evaluate the age + dedupe-key scoping predicate so the
          // test can assert exactly which dedupe rows are removed.
          matched = __control.notifLogDeleteRows.filter((r) =>
            matchRow(cond as Cond, r),
          );
          __control.deleted.notifLog = matched;
        } else if (table === userSyncTable) {
          const ns = findEqValue(cond as Cond, "namespace");
          if (ns === COACH_BUILD_NS) {
            // Cron pruner: stash delete by age cutoff.
            matched = __control.coachStashDeleteRows.filter((r) =>
              matchRow(cond as Cond, r),
            );
            __control.deleted.coachStash = matched;
          } else {
            // Marker clear (by buildId or by row version) — count only.
            __control.deletes.userSync++;
          }
        }
        const p = Promise.resolve(matched) as Promise<Row[]> & {
          returning: (_arg?: unknown) => Promise<Row[]>;
        };
        p.returning = () => Promise.resolve(matched);
        return p;
      },
    };
  },
};
