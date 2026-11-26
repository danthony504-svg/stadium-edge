import { openingGameSummary, type Method, type OpeningGame, type OpeningPossession, type Side } from "./nbaFirstBasketModel.js";

type Action = {
  actionNumber: number;
  period: number;
  clock?: string;
  actionType?: string;
  description?: string;
  shotResult?: string;
  teamId?: string | number;
  personId?: string | number;
  jumpBallWonPersonId?: string | number;
  jumpBallLostPersonId?: string | number;
  // Complete, chronological possession IDs assigned by the licensed feed adapter.
  possessionIndex?: number;
  possessionTeamId?: string | number;
};
type OpeningFeed = Pick<OpeningGame, "eventId" | "finalAt" | "availableAt" | "teams"> & {
  actions: readonly Action[];
  // Play-by-play v3's "Tip to" is a recovery. An explicit verified winner is
  // required when the source description alone cannot identify the winning jumper.
  verifiedTipWinnerId?: string;
};
const id = (value?: string | number) => value == null ? "" : String(value);
function clockOf(value: string) {
  const live = /^PT(\d+)M(\d{2}(?:\.\d+)?)S$/.exec(value);
  return live ? `${Number(live[1])}:${live[2]}` : value;
}

function shotMethod(play: Action): Method | null {
  const action = play.actionType?.toLowerCase() ?? "";
  const description = play.description ?? "";
  if (action === "freethrow" || /\bfree throw\b/i.test(description)) return "FT";
  if (action === "3pt" || /\b3[ -]?(?:pt|point)\b/i.test(description)) return "3";
  if (action === "2pt" || /^(?:made|missed) shot$/i.test(action)) return "2";
  return null;
}

/** Bind a finalized play feed to the supplied verified starting fives and possession segments. */
export function captureOpeningGame(feed: OpeningFeed) {
  const actions = feed.actions.filter(action => action.period === 1).sort((a, b) => a.actionNumber - b.actionNumber);
  if (actions.some((action, i) => !Number.isInteger(action.actionNumber) || action.actionNumber === actions[i - 1]?.actionNumber)) return null;
  const tip = actions.find(action => /^jump\s*ball$/i.test(action.actionType ?? "") || /^jump ball /i.test(action.description ?? ""));
  if (!tip || !/^12:00(?:\.0+)?$/.test(clockOf(tip.clock ?? ""))) return null;
  const teams = feed.teams;
  const winner = id(tip.jumpBallWonPersonId) || feed.verifiedTipWinnerId;
  const loser = id(tip.jumpBallLostPersonId);
  const sideOf = (teamId: string): Side | null => teamId === teams[0].id ? 0 : teamId === teams[1].id ? 1 : null;
  const tipWinner: Side | null = winner === teams[0].jumperId ? 0 : winner === teams[1].jumperId ? 1 : null;
  if (tipWinner === null || (loser && loser !== teams[1 - tipWinner]!.jumperId)) return null;
  const possessions: { side: Side; shots: OpeningPossession["shots"][number][] }[] = [];
  let index = -1;
  for (const play of actions) {
    if (play.actionNumber <= tip.actionNumber) continue;
    const method = shotMethod(play);
    if (play.possessionIndex == null) {
      if (method) return null;
      continue;
    }
    const side = sideOf(id(play.possessionTeamId));
    if (side === null || !Number.isInteger(play.possessionIndex) || play.possessionIndex < index) return null;
    if (play.possessionIndex !== index) {
      if (index !== -1 && play.possessionIndex !== index + 1) return null;
      index = play.possessionIndex;
      possessions.push({ side, shots: [] });
    }
    const current = possessions.at(-1)!;
    if (current.side !== side) return null;
    if (!method) continue;
    const result = play.shotResult?.toLowerCase() ?? "";
    const made = result === "made" || (!result && (/^made shot$/i.test(play.actionType ?? "") || /\bmakes\b/i.test(play.description ?? "")));
    const missed = result === "missed" || (!result && (/^missed shot$/i.test(play.actionType ?? "") || /\bmisses\b/i.test(play.description ?? "")));
    if ((!made && !missed) || (play.teamId != null && side !== sideOf(id(play.teamId)))) return null;
    current.shots.push({ playerId: id(play.personId), method, made, clock: clockOf(play.clock ?? "") });
  }
  if (!possessions[0]) return null;
  const record: OpeningGame = { eventId: feed.eventId, finalAt: feed.finalAt, availableAt: feed.availableAt,
    teams, tipWinner, firstPossession: possessions[0].side, possessions };
  const opening = openingGameSummary(record);
  return opening ? { ...record, firstPoints: opening.firstPoints, firstFieldGoal: opening.firstFieldGoal } : null;
}
