/**
 * Parse any Coach ask (+ optional priors) into a structured snapshot for QA.
 * Read-only — uses existing parsers only.
 */

import { parseCoachAskMarketConstraint } from "../coachAskMarketFilter.ts";
import {
  coachAskTeamScope,
  excludedTeamScopesFromText,
} from "../coachAskTeamScope.ts";
import { focalSportsFromText } from "../chatContextPriority.ts";
import { coachBoardSportsForAsk } from "../coachPropBoardCoverage.ts";
import { resolveBuildLegTarget } from "../coach/parseAsk.ts";
import { lockedMarketLabelForAsk } from "../lockedMarketQualityShortfall.ts";
import {
  slateDayFromThread,
  threadWantsPropsOnly,
  wantsPropsOnly,
} from "../slate.ts";
import { COACH_QA_SPORTS } from "./sportsIds.ts";
import type { AskSnapshot } from "./types.ts";

export function snapshotAsk(
  ask: string,
  priorUserTexts: string[] = [],
): AskSnapshot {
  const requestedLegs = resolveBuildLegTarget(ask);
  const market = parseCoachAskMarketConstraint(ask, priorUserTexts);
  const isMarketLocked =
    market.allowedMarketKeys != null && market.allowedMarketKeys.length > 0;
  const teamScope = coachAskTeamScope(ask);
  const excluded = excludedTeamScopesFromText(ask);
  const propsOnly = market.propsOnly;
  const gameLinesOnly = market.gameLinesOnly && !propsOnly;
  let pathHint: AskSnapshot["pathHint"] = "full_board_mix";
  if (propsOnly) pathHint = "props_only";
  else if (gameLinesOnly) pathHint = "game_lines_only";

  return {
    ask,
    priorUserTexts: [...priorUserTexts],
    requestedLegs,
    focalSports: [...focalSportsFromText(ask)].sort(),
    boardSports: coachBoardSportsForAsk(ask, requestedLegs || 6, COACH_QA_SPORTS),
    slateDay: slateDayFromThread(ask, priorUserTexts),
    propsOnly,
    gameLinesOnly,
    allowedMarketKeys: market.allowedMarketKeys,
    marketFamilyLabel: lockedMarketLabelForAsk(ask),
    isMarketLocked,
    teamScope: teamScope
      ? { sport: teamScope.sport, matchTokens: [...teamScope.matchTokens] }
      : null,
    excludedTeams: excluded.map((e) => ({
      sport: e.sport,
      matchTokens: [...e.matchTokens],
    })),
    wantsPropsOnlyCurrent: wantsPropsOnly(ask),
    threadWantsPropsOnly: threadWantsPropsOnly(ask, priorUserTexts),
    pathHint,
  };
}
