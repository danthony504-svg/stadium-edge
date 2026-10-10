/**
 * Pending Coach ticket buffer helpers.
 * Keep identity out of long-lived state by draining/clearing on terminal paths.
 */

export type PendingPicksBuf<T> = { current: T[] };

/** Snapshot pending picks, then clear the buffer (absolute terminal / stop). */
export function drainPendingTicketPicks<T>(buf: PendingPicksBuf<T>): T[] {
  const drained = buf.current;
  buf.current = [];
  return drained;
}

/** Drop any leftover pending picks (unmount / new send). */
export function clearPendingTicketPicks<T>(buf: PendingPicksBuf<T>): void {
  buf.current = [];
}
