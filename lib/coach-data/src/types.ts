/** Raw shapes from odds/props API routes — normalized by coach-data, not legacy slate types. */

export type RawGame = {
  sport: string;
  gameId: string;
  gameLabel: string;
  startsAt: string | null;
  status?: string | null;
};

export type RawGameLine = {
  sport: string;
  gameId: string;
  gameLabel: string;
  marketKey: string;
  marketLabel: string;
  pick: string;
  odds: number;
  line: number | null;
  startsAt: string | null;
  isAlt?: boolean;
  book?: string | null;
};

export type RawPlayerProp = {
  sport: string;
  gameId: string;
  gameLabel: string;
  marketKey: string;
  marketLabel: string;
  playerId: string | null;
  playerName: string;
  pick: string;
  odds: number;
  line: number | null;
  side: "Over" | "Under";
  startsAt: string | null;
  isAlt?: boolean;
  book?: string | null;
};

export type CoachRawSlateInput = {
  games: RawGame[];
  gameLines: RawGameLine[];
  props: RawPlayerProp[];
  /** Optional digest strings for fingerprint stability when injuries/status change. */
  injuryDigest?: string;
  gameStatusDigest?: string;
};

export type CoachHorizonFilterResult<T> = {
  kept: T[];
  dropped: number;
};
