import type { PoolClient } from "pg";
import { logger } from "./logger.js";

/** Fixed advisory-lock key pair for coach slate jobs (class, id). */
export const COACH_SLATE_LOCK_CLASS = 87251433;
export const COACH_SLATE_LOCK_ID = 1;

export type CoachSlateLockHandle = {
  client: PoolClient;
  release: () => Promise<void>;
};

/**
 * Try to acquire a session-level Postgres advisory lock for the full job.
 * Caller must hold the returned handle until release() — unlocks + releases pool client.
 */
export async function tryAcquireCoachSlateJobLock(): Promise<CoachSlateLockHandle | null> {
  // Dynamic import so unit tests can load lock constants without DATABASE_URL.
  const { pool } = await import("@workspace/db");
  const client = await pool.connect();
  try {
    const res = await client.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_lock($1::int, $2::int) AS ok",
      [COACH_SLATE_LOCK_CLASS, COACH_SLATE_LOCK_ID],
    );
    if (!res.rows[0]?.ok) {
      client.release();
      return null;
    }
    let released = false;
    return {
      client,
      release: async () => {
        if (released) return;
        released = true;
        try {
          await client.query(
            "SELECT pg_advisory_unlock($1::int, $2::int)",
            [COACH_SLATE_LOCK_CLASS, COACH_SLATE_LOCK_ID],
          );
        } catch (err) {
          logger.warn({ err }, "coach slate: advisory unlock failed");
        } finally {
          client.release();
        }
      },
    };
  } catch (err) {
    client.release();
    throw err;
  }
}
