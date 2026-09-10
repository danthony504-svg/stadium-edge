import type { CoachRawSlateInput } from "@workspace/coach-data";

/** Loads posted odds/props for background scan — implemented by api-server loopback. */
export interface CoachSlateLoader {
  load(): Promise<CoachRawSlateInput>;
}
