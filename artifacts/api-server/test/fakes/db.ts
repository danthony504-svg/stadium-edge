// In-memory fake of the @workspace/db surface that coachBuild.ts touches. It
// emulates just enough of the drizzle query builder for the two functions under
// test (stashAndNotifyBackgroundBuild / stashBackgroundBuildFailure plus the
// clearBackgroundBuildPending they call) — dispatching on TABLE IDENTITY (not on
// the opaque, stubbed WHERE conditions) so the tests are order-independent.
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

export const __control = {
  // Result returned for a SELECT ... FROM userSync (the notifPrefs lookup).
  // Shape mirrors the real row: `[{ data: { master?, coachReady? } }]`.
  notifPrefsRows: [] as Array<{ data: Row }>,
  // Result returned for a SELECT ... FROM pushTokens.
  tokenRows: [{ token: "tok_1" }] as Array<{ token: string }>,
  // Captured writes (the upsert payloads) for assertions.
  writes: { userSync: [] as Row[], notifLog: [] as Row[] },
  // Count of DELETEs per table (marker clears / dead-token prunes).
  deletes: { userSync: 0, pushTokens: 0 },
  // The notif_log dedupe ledger — survives across calls within a test so a
  // second call for the same buildId is correctly rejected (at-most-once).
  notifLogKeys: new Set<string>(),
};

export function resetDb(): void {
  __control.notifPrefsRows = [];
  __control.tokenRows = [{ token: "tok_1" }];
  __control.writes = { userSync: [], notifLog: [] };
  __control.deletes = { userSync: 0, pushTokens: 0 };
  __control.notifLogKeys = new Set<string>();
}

function thenable(rows: unknown) {
  // Awaitable directly (the pushTokens lookup) AND chainable with .limit (the
  // notifPrefs lookup) — both return the same canned rows.
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
          where(_cond: unknown) {
            const rows =
              table === pushTokensTable
                ? __control.tokenRows
                : __control.notifPrefsRows;
            return thenable(rows);
          },
        };
      },
    };
  },
  delete(table: unknown) {
    return {
      where(_cond: unknown) {
        if (table === userSyncTable) __control.deletes.userSync++;
        if (table === pushTokensTable) __control.deletes.pushTokens++;
        return Promise.resolve();
      },
    };
  },
};
