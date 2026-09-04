import { API_BASE } from "./apiBase.ts";

export type StealOddsSportProbe = {
  sport: string;
  endpoint: string;
  ok: boolean;
  httpStatus: number;
  responseTimeMs: number;
  games: number;
  error?: string;
};

export type StealFeedDiagnostics = {
  provider: string;
  scanEndpoint: string;
  responseTimeMs: number;
  httpStatus?: number;
  ok?: boolean;
  oddsKeyConfigured: boolean;
  sportsProbed: number;
  sportsOk: number;
  sportsFailed: number;
  sportProbes: StealOddsSportProbe[];
  errorReason: string | null;
};

export type StealFeedClientLog = {
  endpoint: string;
  fullUrl: string;
  httpStatus: number | null;
  responseTimeMs: number;
  provider: string;
  errorReason: string | null;
  feedDegraded: boolean;
  ok: boolean;
  sportProbes: StealOddsSportProbe[];
};

export function logStealFeedClient(log: StealFeedClientLog): void {
  const line = [
    "[steals-feed]",
    `endpoint=${log.endpoint}`,
    `status=${log.httpStatus ?? "none"}`,
    `ms=${log.responseTimeMs}`,
    `provider=${log.provider}`,
    `ok=${log.ok}`,
    log.errorReason ? `reason=${log.errorReason}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  console.info(line);
  if (log.sportProbes.length) {
    console.info("[steals-feed] sportProbes", JSON.stringify(log.sportProbes));
  }
}

export async function readStealFeedHttpResponse(
  res: Response,
  path: string,
  started: number,
): Promise<{ httpStatus: number; bodyText: string; responseTimeMs: number }> {
  const responseTimeMs = Date.now() - started;
  const bodyText = await res.text();
  return { httpStatus: res.status, bodyText, responseTimeMs };
}

export function stealFeedPath(): string {
  return "/sports/live-steals";
}

export function stealFeedFullUrl(): string {
  return `${API_BASE}${stealFeedPath()}`;
}
