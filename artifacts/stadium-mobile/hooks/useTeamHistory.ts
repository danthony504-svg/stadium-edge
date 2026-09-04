import { useQuery } from "@tanstack/react-query";

import {
  getTeamHistoryByName,
  type TeamHistoryResolved,
  type TeamSearchResult,
} from "@/lib/api";

// Detail screens used to chain searchTeam → getTeamHistory (two round trips,
// serial on the client). This hook hits the combined server endpoint instead
// and shares the react-query cache key across team-pick + props sheets.
export function useTeamHistory(args: {
  sport: string;
  name: string;
  teamId?: string | null;
  enabled?: boolean;
}) {
  const sport = args.sport;
  const name = args.name;
  const teamId = args.teamId ?? null;
  const enabled = args.enabled !== false;

  const q = useQuery({
    queryKey: ["team-history-by-name", sport, teamId || name],
    enabled: enabled && !!sport && (!!teamId || name.length >= 2),
    staleTime: 10 * 60_000,
    retry: 1,
    queryFn: ({ signal }) =>
      getTeamHistoryByName(sport, name, { teamId: teamId || undefined, signal }),
  });

  const data = q.data ?? null;
  const resolved: TeamSearchResult | null = data?.resolved ?? null;
  const history: TeamHistoryResolved | null = data;

  return {
    ...q,
    history,
    resolved,
    teamId: history?.teamId ?? resolved?.teamId ?? teamId,
  };
}
