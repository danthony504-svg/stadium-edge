import { getJson } from "./api.ts";
import type { CoachV2SlateResponse, CoachV2TicketResponse } from "./coachV2Types.ts";

export type CoachV2FetchOpts = {
  legs?: number;
  sport?: string | null;
  signal?: AbortSignal;
};

export async function fetchCoachV2Slate(
  opts?: CoachV2FetchOpts,
): Promise<CoachV2SlateResponse | null> {
  try {
    const params = new URLSearchParams();
    if (opts?.legs != null && opts.legs >= 3) params.set("legs", String(opts.legs));
    if (opts?.sport) params.set("sport", opts.sport);
    const qs = params.toString();
    const path = qs ? `/coach/v2/slate?${qs}` : "/coach/v2/slate";
    return await getJson<CoachV2SlateResponse>(path, opts?.signal, 12_000);
  } catch {
    return null;
  }
}

export async function fetchCoachV2Ticket(
  opts: CoachV2FetchOpts & { legs: number },
): Promise<CoachV2TicketResponse | null> {
  try {
    const params = new URLSearchParams();
    params.set("legs", String(opts.legs));
    if (opts.sport) params.set("sport", opts.sport);
    return await getJson<CoachV2TicketResponse>(
      `/coach/v2/ticket?${params.toString()}`,
      opts.signal,
      12_000,
    );
  } catch {
    return null;
  }
}
