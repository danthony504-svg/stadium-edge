import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Keyboard,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "@clerk/expo";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { CoachTicketHeader } from "@/components/CoachTicketHeader";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { PeriodGameLogCard, type PeriodGameLogCardData } from "@/components/PeriodGameLogCard";
import {
  PickCard,
  gameSideFromPick,
  gameTotalFromPick,
  parsePicks,
  backfillPicks,
  backfillProps,
  norm,
  marketFamily,
  ALT_BACKFILL_ORDER,
  PERIOD_BACKFILL_ORDER,
  GENERIC_BACKFILL_ORDER,
  type ParsedPick,
  type AltRungBias,
} from "@/components/PickCard";
import { PlayerStatCard, type PlayerStatCardData } from "@/components/PlayerStatCard";
import { TeamStatCard, type TeamStatCardData } from "@/components/TeamStatCard";
import { TicketScanSummary, type TicketScanLeg } from "@/components/TicketScanSummary";
import {
  attachPickScores,
  coachFlashEnrichFromBuilt,
  type CoachFlashEnrich,
  type PlayerHistorySlice,
} from "@/lib/pickScoreContext";
import {
  loadPropSimulationsProgressive,
  patchLastAssistantPicks,
  picksWithSimPending,
} from "@/lib/propSimProgressive";
import { enrichChatContextProps, type PropSelectionOpts } from "@/lib/propSelection";
import { enforceMlLeanOnPicks, mlLeanEnforcementNote } from "@/lib/mlLeanEnforcement";
import {
  buildGameTeamIdMap,
  fetchCoachGameSimulationsForPicks,
  fetchSlateGameSimulations,
  filterCoachPicksWithGameSim,
  filterNegativeEdgeGameLines,
  supplementCoachGameSimulations,
  aliasCoachGameSimLabels,
  type CoachGameSimEntry,
} from "@/lib/coachGameMonteCarlo";
import { isGameLinePick } from "@/lib/gameSimScoring";
import { passesCoachSimQualityGate } from "@/lib/gameSimQualityGates";
import { optimizeGameLinePicksToBestFinalAi, buildGameLineOptimizerNote, mergeOddsEntries, buildEvalLinesByGameMap, buildEvalLinesForAllGames, backfillGameLinesFromEvalScores } from "@/lib/gameLineOptimizer";
import { attachPropPoolLadder, attachSimAltOptionsToPicks } from "@/lib/altLineRecommendations";
import { isQualifyingBackupGameLine, pickShowsAltBadge } from "@/lib/altLinePool";
import { enforceConsistentGameSides } from "@/lib/gameSideConsistency";
import { enforceConsistentPropSides, dropPropsOpposingTrackedPicks } from "@/lib/propSideConsistency";
import { rotatePool, dedupeSameTeamGameLegs, dedupeCoachGameLinePicks, finalizeCoachDeliveryPicks, propShare, prepareDeepParlaySeed, needsParlayBackfill, assembleDeepParlayFromBoard, topUpDeepParlayToTarget, shouldComposeDeepParlayFromBoard, finalizeDeepParlayTicket } from "@/lib/ticketDiversity";
import {
  recentParlayLegKeys,
  recentParlayVarietyContext,
  rememberParlayBuild,
  rotateParlayDisplayOrder,
} from "@/lib/parlayVarietyMemory";
import {
  collectQualifyingGameLines,
  collectReachStagedQualifiers,
  replenishParlayToTarget,
  selectParlayBackupPicks,
  buildQualifyingAltShortfallNote,
  buildFullBoardShortfallNote,
  type ParlayLegReject,
} from "@/lib/parlayReach";
import { fillReachTicketStaged } from "@/lib/parlayReachCore";
import { tagTicketRoles } from "@/lib/boardMarketScanner";
import { parsedPickFromPoolEntry } from "@/lib/propSelection";
import {
  buildTopLegsFromFullBoardScan,
  shouldUseFullBoardScan,
  tryReachFullBoardScan,
  reachBoardScanEligible,
  type FullBoardScanResult,
} from "@/lib/boardMarketScanner";
import {
  confidenceSatisfiesThreshold,
  confidenceScoreFromSignals,
  describeConfidenceThreshold,
  parseConfidenceThreshold,
} from "@/lib/confidence";
import { parseOddsThreshold, oddsSatisfiesThreshold, wantsPeriodMarkets } from "@/lib/format";
import { FONT } from "@/components/ui";
import { AnalysisProgress, type ParlayBuildPhase } from "@/components/AnalysisProgress";
import { useCoachSlipClearance } from "@/components/SlipBar";
import { useBetSlip, MAX_LEGS } from "@/context/BetSlipContext";
import { usePickTracker } from "@/context/PickTrackerContext";
import { useColors } from "@/hooks/useColors";
import { computeAnalytics, computeModelStrengths } from "@/lib/modelReport";
import { perfMapFromByFamily } from "@/lib/marketWeighting";
import { calibrationFromTrackedPicks } from "@/lib/modelCalibration";
import {
  deliverCoachBoardScanProgress,
  deliverCoachBoardScanTicket,
  coachBoardScanManifestForMessage,
  coachReplyHasScanManifest,
  COACH_EMPTY_BOARD_SCAN_LEAD,
} from "@/lib/coachBoardScanDelivery";
import { coachBoardScanTicketPicks, coachFlashTicketPicks, filterCoachDeliveredPicks, filterTicketPicks, filterTicketPicksPreservingTicket, finalizeCoachTicketPicks, pickIsAiRecommended, pickQualifiesForTicketGrade, qualifiesAltPick, sanitizeCoachTicketPicks, stripCoachTicketHrvp } from "@/lib/pickRecommendation";
import {
  rescoreCoachTicketPreservingLegs,
  topUpCoachTicketToTarget,
} from "@/lib/coachTicketRescore";
import { applyCoachTicketInvariants, boardScanToCoachTicket, coerceCoachDisplayPicks, prepareCoachDeliveredTicket } from "@/lib/coachTicketKernel";
import {
  coachParlayKernelSkipStream,
  resolveCoachParlayKernelTicket,
} from "@/lib/coachParlayEngine";
import { partitionCoachNotes } from "@/lib/coachNotePartition";
import {
  boardScanIsComplete,
  boardScanMatchesLegTarget,
  boardScanReadyForDelivery,
  buildFixedLegCountShortfallLead,
  ensureFixedLegShortfallLegNote,
  preferFinalBoardScanForDelivery,
  shouldAllowReachCountBackfill,
  shouldBlockUngradedParlayTopUp,
  shouldPromoteQualifyingAltsForFixedLegTicket,
  stripFillerBackfillPicks,
} from "@/lib/coachScanPolicy";
import { logCoachPickDiag } from "@/lib/coachPickDiagnostics";
import {
  emptyReasonForScan,
  logEmptyScanTerminalFired,
  mergeBoardScanSnapshot,
  shouldFireEmptyScanTerminal,
} from "@/lib/coachEmptyScanTerminal";
import {
  logDeliveryPoll,
  readBoardScanFinal,
  stashBoardScanFinal,
  type BoardScanFinalRegistry,
} from "@/lib/coachBoardScanLifecycle";
import { coachOtaCommitLabel, traceCoachPath } from "@/lib/coachPathTrace";
import { awaitBoardScanUntilComplete } from "@/lib/coachBoardScanAwait";
import {
  deriveBoardScanLiveProgress,
  type BoardScanLiveProgress,
} from "@/lib/coachBoardScanProgress";
import { traceCoachTicket } from "@/lib/coachTicketTrace";
import {
  boardScanAppliesToRequest,
  finalizeCoachTicketForRequest,
  recordCoachTicketDelivered,
  rejectPrefixOfLastDelivered,
  startCoachTicketRequest,
  varietyContextWithLastDelivered,
  type CoachTicketRequestContext,
} from "@/lib/coachRequestLifecycle";
import { detectCoachTicketStyle } from "@/lib/coachTicketQualityTiers";
import { stripTrailingReminder } from "@/lib/reminderStrip";
import { coachBuildSports, excludedSportsFromThread, filterEvalLinesByExcludedSports, filterForExcludedSports, focalSportsFromText, resolveExcludedSports, scrubExcludedSportsFromPicks } from "@/lib/chatContextPriority";
import { takeCoachLaunch } from "@/lib/coachSilentLaunch";
import {
  isUnsupportedSoccerDisciplineAsk,
  unsupportedSoccerDisciplineReply,
} from "@/lib/unsupportedCoachMarkets";
import { blockOtaReload } from "@/lib/otaBlock";
import { coachTicketUpgraded, notifyCoachTicketOptimized } from "@/lib/coachOptimizationNotify";
import {
  readSlatePreAnalysisSeed,
  setCoachBuildBusy,
  startSlatePreAnalysis,
  stopSlatePreAnalysis,
  hydrateCoachSlateFromServer,
} from "@/lib/slatePreAnalysis";
import { hydrateSlatePreAnalysisCache } from "@/lib/slatePreAnalysisCache";
import {
  COACH_SLATE_PREVIEW_NOTE,
  coachLiveScanSports,
  markBoardScanAsPreview,
} from "@/lib/coachSlateFreshness";
import { buildParlaySalvagePicks, topUpParlayPicks } from "@/lib/parlaySalvage";
import { buildSoccerScorerGkPicks } from "@/lib/soccerScorerGkSalvage";
import {
  filterBettableOddsGames,
  filterBettablePicks,
  enrichPicksWithStartsAt,
  filterCoachHorizonPicksAfterEnrich,
  preferBettableQualifiedPicks,
  filterOddsForSlateDay,
  filterPicksForSlateDay,
  mentionsPropIntent,
  slateDayFromThread,
  slateOddsLabel,
  tonightExhaustedNote,
  todayBuildNote,
  wantsPropsOnly,
  effectiveBuildLegCount,
  explicitSingleGameIntent,
  wantsMlbPitcherSlateAsk,
  wantsPropPickRecommendation,
  wantsSoccerScorerGoalkeeperPicks,
  wantsTonightSlate,
} from "@/lib/slate";
import {
  buildChatContext,
  buildTinyParlayContext,
  buildCompactParlayContext,
  buildFocalSportParlayContext,
  buildPropsOnlyParlayContext,
  buildMlbSlateContext,
  buildPropPickContext,
  gameMatchesFocalText,
  getGames,
  getLiveOdds,
  getOdds,
  getPlayerHistory,
  getStatmuseGamelog,
  getTeamHistory,
  getSync,
  propPoolFromRealProps,
  searchPlayer,
  searchTeam,
  wantsTodayOnly,
  wantsTomorrowOnly,
  streamChat,
  slimChatContextForUpload,
  ultraSlimChatContextForUpload,
  microSlimChatContextForUpload,
  compactSlimChatContextForUpload,
  largeCompactSlimChatContextForUpload,
  propsOnlySlimChatContextForUpload,
  soccerScorerGkSlimChatContextForUpload,
  warmApiForCoachBuild,
  chatStreamFailureMessage,
  ChatStreamError,
  isAbortLikeError,
  type AltSign,
  type ChatContext,
  type ChatMessage,
  type CoachBuildStash,
  type GameMeta,
  type PropPoolEntry,
  type RealOddsEntry,
  type RealPropEntry,
} from "@/lib/api";
import { DEFAULT_SPORTS } from "@/lib/sports";
import { NAME_FALLBACK_SKIP, parseStatLookup, isCoachRecommendationQuestion, isPitcherInningsWorkloadAsk } from "@/lib/statLookup";
import {
  decideBackgroundRestore,
  deserializePendingBuild,
  makeBuildId,
  pendingBuildMaxWaitMs,
  serializePendingBuild,
  shouldAbortForHandoff,
  shouldHandOffBuild,
} from "@/lib/backgroundBuild";

type UIMessage = {
  role: "user" | "assistant";
  content: string;
  picks?: ParsedPick[];
  // A short transparency line shown above the cards when a parlay delivered
  // fewer legs than the user asked for — either capped at the 15-leg slip max
  // or short because the real board was too thin to ground that many.
  legNote?: string;
  /** Full sim / diversity / optimizer transparency — collapsed under AI Summary. */
  coachDetailNote?: string;
  /** Near-miss legs that almost cleared quality filters when ticket is short of requested count. */
  backupPicks?: ParsedPick[];
  backupNote?: string;
  statCard?: PlayerStatCardData;
  periodGameLog?: PeriodGameLogCardData;
  teamCard?: TeamStatCardData;
  // Local URIs of user-attached photos (up to 3), shown in the user bubble.
  imageUris?: string[];
  // Set on the recovery message shown when a background build couldn't finish
  // (stalled / errored, nothing stashed). Holds the original prompt so the
  // attached "Try again" button can re-run the exact same build.
  retry?: string;
  // Snapshot of the slip captured when the user runs "Analyze my ticket" — used
  // to render the Ticket Scan summary card above the streamed analysis. Held on
  // the message (not live state) so it stays accurate even if the slip changes.
  analyzeSlip?: TicketScanLeg[];
  /** Home hero / one-tap shortcuts — still sent to the model, not shown as a bubble. */
  hideBubble?: boolean;
  /** Full prompt sent to the model when the bubble shows shorter chip copy. */
  apiContent?: string;
  /** Parlay build in flight — survives even if the user bubble is hidden. */
  parlayBuild?: boolean;
  /** Requested leg count for this ticket — drives visible shortfall copy in the header. */
  ticketLegTarget?: number;
};

type StatCardResult = {
  statCard?: PlayerStatCardData;
  periodGameLog?: PeriodGameLogCardData;
  teamCard?: TeamStatCardData;
};

// ---- Background-finished parlay builds (Task: continue-on-disconnect) --------
// When a parlay build is in flight and the user backgrounds the app (or leaves),
// the phone's socket dies and the in-app stream would stall and fail. Instead we
// ask the server to FINISH the ticket and push when ready. To rebuild the exact
// same pick cards on return — with zero re-fetching and zero fabrication — we
// stash the LOCAL build context (the same odds/props/matchups the model saw)
// keyed by a buildId. The server stashes the finished reply text + resolved prop
// pool under the same buildId; on return we marry the two and replay them
// through the normal parse/render path.
const PENDING_BUILD_KEY = "coach.pendingBuild";

// How long we'll wait for a handed-off build's result before treating it as a
// stall and offering a retry (instead of an endless "still building"). Default
// for non-leg asks; leg-scaled via pendingBuildMaxWaitMs(). The poll re-checks
// the stash at PENDING_POLL_MS while we wait.
const PENDING_BUILD_MAX_WAIT_MS = 120_000;
const PENDING_POLL_MS = 5_000;
const INSTANT_SLATE_SEED_MIN_LEGS = 3;

/** Board-scan wall clock — props + game sims for deep fixed-leg asks. */
function boardScanBudgetMs(targetLegs: number): number {
  if (targetLegs >= 15) return 180_000;
  if (targetLegs >= 9) return 150_000;
  return 120_000;
}

/** Stall copy only when nothing has appeared — must exceed context fetch + board scan. */
function buildStallBudgetMs(requestedLegs: number): number {
  if (requestedLegs >= 15) return 300_000;
  if (requestedLegs >= 6) return 240_000;
  return 120_000;
}

/** Wait for an in-flight board scan — no timer; scan must finish or abort. */
async function awaitInFlightBoardScan(
  inflight: Promise<FullBoardScanResult | null> | null | undefined,
  signal?: AbortSignal,
): Promise<FullBoardScanResult | null> {
  return awaitBoardScanUntilComplete(inflight, signal);
}

async function resolveScanForKernelDelivery(
  legTarget: number,
  candidates: {
    preBoardScan: FullBoardScanResult | null;
    latest: FullBoardScanResult | null;
    earlyInflight: Promise<FullBoardScanResult | null> | null;
  },
  signal?: AbortSignal,
): Promise<FullBoardScanResult | null> {
  const target = Math.min(legTarget, MAX_LEGS);
  let scan = preferFinalBoardScanForDelivery(
    target,
    candidates.preBoardScan,
    candidates.latest,
  );
  if (scan?.scanComplete) {
    logCoachPickDiag("delivery-result", {
      stage: "resolve-scan-cache-hit",
      pickCount: scan.picks.length,
      scanComplete: true,
    });
    return scan;
  }
  const early = await awaitInFlightBoardScan(candidates.earlyInflight, signal);
  scan = preferFinalBoardScanForDelivery(
    target,
    early,
    scan,
    candidates.latest,
    candidates.preBoardScan,
  );
  if (scan?.scanComplete) {
    logCoachPickDiag("delivery-result", {
      stage: "resolve-scan-after-await",
      pickCount: scan.picks.length,
      scanComplete: true,
    });
    return scan;
  }
  if (early?.scanComplete) {
    logCoachPickDiag("delivery-result", {
      stage: "resolve-scan-early-complete",
      pickCount: early.picks.length,
      scanComplete: true,
    });
    return early;
  }
  logCoachPickDiag("delivery-result", {
    stage: "resolve-scan-after-await",
    pickCount: scan?.picks.length ?? 0,
    scanComplete: scan?.scanComplete ?? false,
  });
  return scan;
}

type PendingBuild = {
  buildId: string;
  userText: string;
  context: ChatContext;
  propPool: PropPoolEntry[];
  gameMeta: GameMeta[];
  todayOnly: boolean;
  createdAt: number;
};

// makeBuildId / (de)serialize live in lib/backgroundBuild.ts (pure + unit-tested).

async function savePendingBuild(b: PendingBuild): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_BUILD_KEY, serializePendingBuild(b));
  } catch {
    /* storage unavailable — background replay just won't be possible */
  }
}

async function loadPendingBuild(): Promise<PendingBuild | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_BUILD_KEY);
    return deserializePendingBuild<PendingBuild>(raw);
  } catch {
    return null;
  }
}

async function clearPendingBuild(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_BUILD_KEY);
  } catch {
    /* ignore */
  }
}

// Resolve a player/stat question into a REAL stat card. Returns null when the
// message isn't a stat lookup or no real player/data resolves — the caller then
// falls back to the AI chat path. Throws AbortError if cancelled. Never
// fabricates: every value comes from ESPN (player-history) or StatMuse's real
// results grid (statmuse-gamelog).
async function tryStatCard(text: string, signal: AbortSignal): Promise<StatCardResult | null> {
  if (isCoachRecommendationQuestion(text)) return null;

  const lookup = parseStatLookup(text);
  if (!lookup) return null;

  const searchOpts = { rawMessage: text };
  const sr = await searchPlayer(lookup.name, signal, searchOpts);
  // ESPN search is relevance-ranked; trust the top hit so historical/retired
  // queries resolve to the right athlete instead of being overridden by any
  // active player further down the list.
  let top = (sr.results || [])[0] || null;

  // ESPN's player search needs a clean name — any residual filler
  // ("wembanyama will", "jokic dominate wednesday") makes it return nothing.
  // If the full extracted name missed (and this wasn't a bare chatter guess),
  // retry with contiguous sub-spans of the name, longest → shortest and
  // left-to-right, skipping pure-filler tokens. The first real ESPN hit wins.
  // This rescues forward-looking phrasings ("how many points will X score
  // tonight?") without over-stripping real names like "Will Smith" (which
  // resolve on the first try, so this fallback never runs for them).
  if (!top && !lookup.bareName && !/\b or \b/i.test(text)) {
    const toks = String(lookup.name)
      .toLowerCase()
      .replace(/[^a-z'.\- ]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    const fullLow = String(lookup.name).toLowerCase().trim();
    const norm = (s: string) =>
      String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    spanSearch: for (let len = Math.min(toks.length, 3); len >= 1; len--) {
      for (let i = 0; i + len <= toks.length; i++) {
        const cand = toks.slice(i, i + len).join(" ");
        if (cand === fullLow || cand.length < 3) continue;
        if (len === 1 && NAME_FALLBACK_SKIP.has(cand)) continue;
        try {
          const fr = await searchPlayer(cand, signal, searchOpts);
          const hit = (fr.results || [])[0];
          // Guard against ESPN's fuzzy single-token search returning an
          // unrelated player: the candidate must match a WHOLE WORD in the
          // resolved name (accent-insensitive) — not merely be a substring. A
          // substring check let "ever" bind to
          // "sEVERino", so "Have you ever predicted a home run?" answered with
          // Luis Severino's card. Whole-word matching keeps the real rescue
          // cases ("wembanyama" ⊂ ["victor","wembanyama"]) and kills the leak.
          const nameToks = norm(hit?.name || "").split(/\s+/).filter(Boolean);
          const candWhole =
            norm(cand).split(/\s+/).filter(Boolean).every((c) => nameToks.includes(c));
          if (hit && hit.name && candWhole) {
            top = hit;
            lookup.name = hit.name;
            break spanSearch;
          }
        } catch (e: any) {
          if (e?.name === "AbortError") throw e;
          // keep trying spans
        }
      }
    }
  }
  // No player resolved — try resolving the name to a TEAM instead so team
  // questions ("Lakers stats", "how are the Celtics doing") get a real card.
  // Player-first preserves existing behavior; this is a pure fallback. On a team
  // miss we return null so the caller falls through to the AI (never fabricates).
  if (!top) {
    try {
      const tr = await searchTeam(lookup.name, signal);
      const team = (tr.results || [])[0] || null;
      if (team) {
        const teamHistory = await getTeamHistory(team.sport, team.teamId, signal);
        return { teamCard: { resolved: team, history: teamHistory } };
      }
    } catch (e: any) {
      if (e?.name === "AbortError") throw e;
      // Fall through to the AI chat path on any non-abort error.
    }
    return null;
  }

  // Period intent ("first quarter points") → StatMuse per-game period grid.
  // ESPN game logs have no period splits, so this is the only real source.
  if (lookup.period && lookup.periodPhrase) {
    const statWord = lookup.statWord || "points";
    // Honor an explicit opponent ("vs the Knicks") so StatMuse filters the grid
    // to those matchups instead of returning the last 5 games regardless.
    const oppPhrase = lookup.opponent ? ` vs the ${lookup.opponent}` : "";
    const q = `${top.name} ${lookup.periodPhrase} ${statWord}${oppPhrase} last 5 games game by game`;
    try {
      const gl = await getStatmuseGamelog(q, top.sport, signal);
      if (gl?.rows && gl.rows.length >= 1) {
        return {
          periodGameLog: {
            ...gl,
            player: gl.player || top.name,
            period: gl.period || lookup.periodPhrase,
            stat: gl.stat || statWord,
            opponent: lookup.opponent,
          },
        };
      }
    } catch (e: any) {
      if (e?.name === "AbortError") throw e;
      // Fall through to the full-game ESPN card (with an honest period note).
    }
  }

  const history = await getPlayerHistory(
    {
      sport: top.sport,
      athleteId: top.athleteId,
      season: lookup.season,
      opponentName: lookup.opponent,
    },
    signal,
  );
  return {
    statCard: {
      resolved: top,
      history,
      requestedStatCols: lookup.statCols,
      opponentRequested: lookup.opponent,
      periodRequested: lookup.period && !isPitcherInningsWorkloadAsk(text),
    },
  };
}

const QUICK_PROMPTS: { label: string; prompt: string }[] = [
  { label: "3-Leg parlay", prompt: "Build me a 3-leg parlay" },
  { label: "5-Leg parlay", prompt: "Build me a 5-leg parlay" },
  { label: "6-Leg parlay", prompt: "Build me a 6-leg parlay" },
  { label: "9-Leg parlay", prompt: "Build me a 9-leg parlay" },
  { label: "15-Leg longshot", prompt: "Build me a 15-leg longshot parlay" },
  { label: "Player props only", prompt: "Build me a player props only parlay" },
];

const CHAT_SEEN_KEY = "se_chat_seen";
const EXCLUDED_SPORTS_KEY = "se_coach_excluded_sports";

const WELCOME_FIRST_TIME =
  "Welcome to Stadium Edge. I’m connected to live odds, live game data, and an AI brain built for sports analysis. Toggle PICK LIVE to load real-time matchups, then ask me anything — I factor in odds value, team form, coaching tendencies, injuries, and weather conditions to give you the sharpest possible take.\n\nParlay builds default to today’s upcoming slate — only games on today’s board that haven’t started yet. Say \"for tomorrow\" if you want the next day’s board instead.\n\nTap 3-Leg, 6-Leg, 9-Leg, or 15-Leg to build a parlay that size, or just type what you want. Heads up: confidence compounds down with each leg — a 15-leg parlay is a true longshot.";

const WELCOME_RETURNING =
  "Stadium Edge is locked in. Parlays use real posted odds by default — today’s upcoming games only, unless you ask for tomorrow. Tap 3-Leg, 6-Leg, 9-Leg, or 15-Leg — or just tell me what you want. Let’s build.";

function isWelcomeMessage(m: { role: string; content: string }): boolean {
  return (
    m.role === "assistant" &&
    (m.content === WELCOME_FIRST_TIME || m.content === WELCOME_RETURNING)
  );
}

// What the chat bubble shows for an assistant reply. Once a reply has resolved
// into pick cards, the bubble is hidden entirely — each pick's reasoning lives in
// its card's EDGE note. While a parlay is still STREAMING (picks not parsed yet),
// we also strip everything from the first PICK/ALT line onward so the user never
// sees the raw "PICK:/EDGE:/ALT:" scaffolding — only the lead-in prose shows, and
// a "Building your parlay…" indicator signals the rest is on the way. Plain Q&A
// replies (no PICK lines) show their full text unchanged.
// Matches ONLY the pipe-delimited pick scaffold the parser emits
// ("PICK: game | market | selection | odds" / "ALT: ..."), not a prose line that
// merely starts with "Pick:" — requires at least two "|" separators after the
// colon so normal Q&A is never truncated.
const PICK_SCAFFOLD_RE = /^(?:PICK|ALT)\s*:.*\|.*\|/i;

/** Legacy 25s watchdog copy from older OTAs — never show as a chat bubble. */
const DEAD_BUILD_PROSE_RE = /still scoring every market/i;
/** Stale Try again dead-end from builds that ended before scan delivery finished. */
const STALE_PARLAY_DEAD_END_RE =
  /finished without pick cards|board scan may still be scoring|tap below to try again/i;

function scrubDeadBuildProseFromMessages(msgs: UIMessage[]): UIMessage[] {
  let changed = false;
  const next = msgs.map((m) => {
    if (m.role !== "assistant") return m;
    const stale =
      DEAD_BUILD_PROSE_RE.test(m.content) || STALE_PARLAY_DEAD_END_RE.test(m.content);
    if (!stale) return m;
    changed = true;
    return {
      ...m,
      content: "",
      retry: undefined,
      parlayBuild: m.parlayBuild ?? true,
    };
  });
  return changed ? next : msgs;
}

/** Drop assistant rows that only carried the legacy watchdog line. */
function pruneDeadParlayPlaceholders(msgs: UIMessage[]): UIMessage[] {
  return msgs.filter((m) => {
    if (isWelcomeMessage(m)) return true;
    if (m.role !== "assistant") return true;
    if (m.picks?.length || m.analyzeSlip?.length || m.statCard || m.periodGameLog || m.teamCard) {
      return true;
    }
    if (m.retry || m.parlayBuild) return true;
    return !DEAD_BUILD_PROSE_RE.test(m.content) && !!m.content.trim();
  });
}

function assistantHasVisibleContent(m: UIMessage): boolean {
  if (m.picks?.length || m.analyzeSlip?.length || m.statCard || m.periodGameLog || m.teamCard) {
    return true;
  }
  if (m.retry) return true;
  if (m.parlayBuild) return true;
  if (m.coachDetailNote?.trim() || m.legNote?.trim()) return true;
  const text = m.content?.trim() ?? "";
  if (!text) return false;
  if (DEAD_BUILD_PROSE_RE.test(text)) return false;
  if (STALE_PARLAY_DEAD_END_RE.test(text)) return false;
  return true;
}

/** User sent (or build failed) but nothing visible is on screen — quick prompts hidden. */
function isOrphanCoachThread(
  msgs: UIMessage[],
  opts: { streaming: boolean; buildFinishing: boolean },
): boolean {
  if (opts.streaming || opts.buildFinishing || msgs.length === 0) return false;
  const last = msgs[msgs.length - 1];
  if (!last) return true;
  if (last.role === "user") return true;
  if (last.role === "assistant" && !assistantHasVisibleContent(last)) return true;
  return false;
}

function recoverOrphanCoachThread(msgs: UIMessage[]): UIMessage[] {
  if (msgs.length === 0) {
    return [{ role: "assistant", content: WELCOME_RETURNING }];
  }
  const priorUser = [...msgs].reverse().find((m) => m.role === "user");
  if (priorUser) {
    const copy = [...msgs];
    const lastIdx = copy.length - 1;
    if (copy[lastIdx]?.role === "assistant") {
      const parlay = copy[lastIdx].parlayBuild ?? isParlayBuildAsk(priorUser.content);
      const stale = STALE_PARLAY_DEAD_END_RE.test(copy[lastIdx].content ?? "");
      copy[lastIdx] = {
        ...copy[lastIdx],
        parlayBuild: parlay,
        content: stale ? "" : copy[lastIdx].content,
        retry: stale ? undefined : copy[lastIdx].retry,
      };
    }
    return copy;
  }
  return [{ role: "assistant", content: WELCOME_RETURNING }];
}

function isEmptyParlayScanReply(m: UIMessage): boolean {
  if (m.role !== "assistant") return false;
  if (m.picks?.length) return false;
  if (coachReplyHasScanManifest(undefined, m.coachDetailNote)) return true;
  if (m.parlayBuild || m.retry) return true;
  const note = `${m.legNote ?? ""}\n${m.content ?? ""}`;
  return /cleared the AI quality bar|no legs cleared delivery gates/i.test(note);
}

function prunePriorEmptyParlayReplies(msgs: UIMessage[]): UIMessage[] {
  return msgs.filter((m) => !isEmptyParlayScanReply(m));
}

// Does the preceding user message ask us to BUILD a parlay (vs. a plain Q&A that
// merely mentions the word "parlay")? When it does, we suppress the streamed
// lead-in prose ("Here's a balanced 5-leg ticket…") for the whole build and show
// only the "Building your parlay…" indicator, so no intro text lands in the chat
// before the pick cards. Kept conservative (build verbs / leg-count / quick
// prompts) so questions like "what is a parlay" or "is my parlay good" still
// stream their answer normally.
const PARLAY_BUILD_RE =
  /\bbuild\b[^?]*\bparlay\b|\b\d{1,3}[-\s]?leg\b|\blongshot\b|\bplayer props only\b/i;

// "Improve THIS slip" intent (mirror of the server's improveWording in chat.ts).
// When the user uploaded a bet-slip photo and then asks for "a better one", they
// want a BETTER version of THAT SAME slip — same games, same leg count. The slip
// lives only in the image, so on this follow-up (which carries no fresh image) we
// silently re-attach the last uploaded slip photo so the model can re-read it.
// Excludes comparison interrogatives ("which is better?") which are a different
// flow. Typo-tolerant ("batter one" = "better one"), same as the server.
const IMPROVE_SLIP_RE =
  /\b(?:bett?er|batter)\s+(?:one|ticket|slip|version|card|option|parlay)\b|\bmake (?:it|this|that|the (?:ticket|slip|parlay|card|bet)) (?:better|stronger|cleaner|safer|tighter|less correlated)\b|\bimprove\b[^\n]{0,18}\b(?:this|that|it|ticket|slip|parlay|card|legs?)\b|\b(?:fix|tighten|trim|diversif\w*|de-?correlate|clean up)\b[^\n]{0,18}\b(?:this|that|it|ticket|slip|parlay|card|legs?)\b/i;
const IMPROVE_COMPARISON_RE =
  /\b(?:which|what(?:'s| is| are)?|compare|versus|\bvs\.?\b|rank)\b[^\n]{0,40}\bbett?er\b/i;
// "do better" / "can you do better" / "how can you do better" / "do any better"
// is an unambiguous ask to improve the thing under discussion — a comparison
// ("which is better") never uses the verb "do", so this bypasses the comparison
// exclusion below and reliably re-attaches the last slip photo.
const DO_BETTER_RE =
  /\b(?:do|doing|does|did)\s+(?:any\s+|it\s+|this\s+|that\s+)?bett?er\b/i;
function wantsImproveSlip(text: string): boolean {
  if (DO_BETTER_RE.test(text)) return true;
  return IMPROVE_SLIP_RE.test(text) && !IMPROVE_COMPARISON_RE.test(text);
}

// "Analyze THIS ticket" intent (mirror of the server's analyzeWording in
// chat.ts). The slip overlay's "Analyze ticket" button sends a fixed
// "Analyze my ticket" prompt, but a user can also type "grade my slip",
// "break down this parlay", "how risky is my ticket", etc. This is a READ-ONLY
// critique — the server emits NO PICK lines for it — so client-side we also
// suppress pick parsing as a belt-and-braces guard, keeping the existing slip
// untouched even if a stray PICK line slips through. Excludes the improve flow
// (which rebuilds), since that owns the "make it better" phrasing.
const ANALYZE_SLIP_RE =
  /\b(?:analy[sz]e|break\s*down|grade|rate|review|assess|evaluate|critique|check)\b[^\n]{0,24}\b(?:this|that|it|my|the|ticket|slip|parlay|card|bet|bets|legs?)\b|\b(?:thoughts on|how (?:good|bad|strong|risky))\b[^\n]{0,24}\b(?:ticket|slip|parlay|card|bet|bets|legs?)\b/i;
function wantsAnalyzeSlip(text: string): boolean {
  return ANALYZE_SLIP_RE.test(text) && !wantsImproveSlip(text);
}

// Pull a requested leg count out of the user's ask ("build me a 50 leg",
// "6-leg parlay") so we can be honest when we deliver fewer — capped at the
// 15-leg slip max, or short because the real board was too thin to ground that
// many. Allows up to 3 digits so big asks like "100 leg" are captured too.
function requestedLegCount(text: string): number {
  const m = text.match(/\b(\d{1,3})\s*[-\s]?\s*leg/i);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : 0;
}

function isParlayBuildAsk(text: string): boolean {
  return PARLAY_BUILD_RE.test(text) || requestedLegCount(text) > 0;
}

function appendUniqueNote(existing: string, addition: string): string {
  const next = addition.trim();
  if (!next) return existing;
  if (existing.includes(next)) return existing;
  return existing ? `${existing}\n\n${next}` : next;
}

/** Collapse duplicate paragraphs (e.g. repeated side-alignment notes). */
function dedupeLegNoteParagraphs(note: string): string {
  const parts = note.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out.join("\n\n");
}

// assistantBubbleText also strips the model's trailing responsible-gambling
// sign-off (see lib/reminderStrip) so it doesn't render as a dangling line.
function assistantBubbleText(content: string, hasPicks: boolean): string {
  if (hasPicks) return "";
  if (DEAD_BUILD_PROSE_RE.test(content)) return "";
  const lines = content.split("\n");
  const idx = lines.findIndex((l) => PICK_SCAFFOLD_RE.test(l.trim()));
  const kept = idx === -1 ? lines : lines.slice(0, idx);
  return stripTrailingReminder(kept.join("\n"));
}

// Does the user want the coach's TAKE/projection, not just the raw stat card?
// A pure lookup ("Wembanyama points last 10 games") is fully answered by the
// card, but an opinion/projection question ("how many points do you think he'll
// score tonight?", "is the over a good bet?") wants an actual answer — so we
// keep showing the real card AND stream a grounded reply.
const PROJECTION_RE =
  /\b(do you think|you think|think (?:he|she|they|it)|predict(?:ion)?|project(?:ion|ed|ing)?|expect(?:ed|ing|s)?|forecast|your (?:take|thoughts|opinion|guess|prediction|call)|thoughts on|over or under|over\/under|o\/u|should i|good bet|worth (?:a )?(?:bet|play|shot)|likely to|going to|gonna)\b/i;
// Subject is negative-lookahead'd against "you" so an assistant-addressed lookup
// ("can you get me his stats") stays card-only, while a player-subject projection
// ("would he get a hit", "can Ben Rice hit 2 today") triggers the grounded reply.
const PROJECTION_WILL_RE =
  /\b(?:will|would|can|could)\s+(?!you\b)[a-z.'’\- ]{2,30}?\s(?:score|get|have|put up|go for|drop|record|tally|hit|reach|exceed|pitch|play|start|throw)\b/i;
const PROJECTION_HOW_MANY_RE =
  /\bhow many\b/i;

function isProjectionQuestion(text: string): boolean {
  const low = text.toLowerCase();
  if (PROJECTION_RE.test(text) || PROJECTION_WILL_RE.test(text)) return true;
  if (
    PROJECTION_HOW_MANY_RE.test(text) &&
    /\b(innings?|points?|pts|goals?|minutes?|mins?|yards?|rebounds?|assists?|strikeouts?|hits?|touchdowns?|receptions?)\b/.test(
      low,
    )
  )
    return true;
  if (
    /\b(?:will|would|can|could|should)\s+(?!you\b)[a-z][\w.'-]*(?:\s+[a-z][\w.'-]*){0,2}\s+(?:pitch|play|start|throw)\b/i.test(
      text,
    ) &&
    /\b(?:today|tonight|this game|tonight'?s|this start)\b/i.test(low)
  )
    return true;
  return false;
}

// Build a compact REAL-DATA grounding block from a resolved stat card so the AI
// answers a projection question using ONLY these numbers. Every value comes
// straight from the card (ESPN player-history / StatMuse grid) — nothing here is
// invented, which keeps the never-fabricate rule intact.
function serializeStatCardForAI(card: StatCardResult): string {
  if (card.teamCard) {
    const { resolved, history } = card.teamCard;
    const f = history.last10;
    const recent = (history.recent || []).slice(0, 10);
    const games = recent
      .map((g) => {
        const loc = g.home ? "vs" : "@";
        const score = g.pts == null || g.oppPts == null ? "" : ` ${g.pts}-${g.oppPts}`;
        const wl = g.won === true ? " W" : g.won === false ? " L" : "";
        return `${g.date ?? ""} ${loc} ${g.opp ?? ""}${score}${wl}`.trim();
      })
      .join("; ");
    return [
      "REAL DATA (use ONLY these numbers; do not invent anything):",
      `${history.teamName || resolved.name} (${String(resolved.sport).toUpperCase()})${
        history.season ? ` — ${history.season} season` : ""
      }`,
      history.record.games
        ? `Record (last ${history.record.games}): ${history.record.wins}-${history.record.losses}.`
        : "",
      f.games
        ? `Last ${f.games}: ${f.wins}-${f.losses}, ${
            f.ptsFor == null ? "n/a" : f.ptsFor.toFixed(1)
          } pts for / ${f.ptsAgainst == null ? "n/a" : f.ptsAgainst.toFixed(1)} against (margin ${
            f.avgMargin == null ? "n/a" : f.avgMargin.toFixed(1)
          }).`
        : "",
      history.streak ? `Streak: ${history.streak.type}${history.streak.count}.` : "",
      games ? `Recent games: ${games}.` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (card.periodGameLog) {
    const g = card.periodGameLog;
    const rows = (g.rows || []).slice(0, 10);
    const nums = rows
      .map((r) => parseFloat(String(r.value).replace(/[^0-9.\-]/g, "")))
      .filter((n) => Number.isFinite(n));
    const avg = nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : "n/a";
    const list = rows.map((r) => `${r.date} ${r.loc} ${r.opp}: ${r.value}`.trim()).join("; ");
    return [
      "REAL DATA (use ONLY these numbers; do not invent anything):",
      `${g.player ?? "Player"} — ${g.period ?? ""} ${g.stat} per game over the last ${rows.length} games.`,
      `Average ${g.stat}: ${avg}.`,
      list ? `Games: ${list}.` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (card.statCard) {
    const { resolved, history } = card.statCard;
    const s = history.seasonSummary || { games: 0, averages: {}, totals: {} };
    const avgs = Object.entries(s.averages || {})
      .map(([k, v]) => `${k} ${v}`)
      .join(", ");
    const recent = (history.recent || []).slice(0, 10);
    const ipVals = recent
      .map((entry) => parseFloat(String(entry.stats?.IP ?? "")))
      .filter((n) => Number.isFinite(n));
    const ipAvg =
      ipVals.length > 0
        ? (ipVals.reduce((a, b) => a + b, 0) / ipVals.length).toFixed(1)
        : null;
    const games = recent
      .map((entry) => {
        const loc = entry.isHome == null ? "" : entry.isHome ? "vs" : "@";
        const stats = Object.entries(entry.stats || {})
          .map(([k, v]) => `${k} ${v}`)
          .join(" ");
        return `${entry.date ?? ""} ${loc} ${entry.opponentName ?? ""}: ${stats}`.trim();
      })
      .join("; ");
    const vsOpp =
      history.vsOpponentName && history.vsOpponent?.length
        ? `vs ${history.vsOpponentName}: ${history.vsOpponent
            .slice(0, 6)
            .map((entry) => {
              const stats = Object.entries(entry.stats || {})
                .map(([k, v]) => `${k} ${v}`)
                .join(" ");
              return `${entry.date ?? ""} ${stats}`.trim();
            })
            .join("; ")}.`
        : "";
    return [
      "REAL DATA (use ONLY these numbers; do not invent anything):",
      `${resolved.name} — ${resolved.team} (${String(resolved.sport).toUpperCase()})`,
      `Season ${history.season ?? ""}: ${s.games} GP.`,
      avgs ? `Per-game averages: ${avgs}.` : "",
      ipAvg ? `Recent starts IP average (last ${ipVals.length}): ${ipAvg}.` : "",
      vsOpp,
      games ? `Last ${recent.length} games: ${games}.` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

// A one-tap add-all / remove-all control above a parlay's pick cards. Picks are
// already resolved to REAL odds entries by parsePicks, so this never fabricates
// a leg — it just funnels each card's pick through the same addLeg()/removeLeg()
// the per-leg button uses. addLeg() refuses duplicates AND a full slip (MAX_LEGS),
// so the in-slip count is purely reactive. Once every leg is in the slip the
// button flips to a "Remove all" action so the user can pull the whole parlay
// back out in one tap; a partial mix offers to add the remaining legs. When the
// slip can't fit them all it reports how many actually landed and surfaces the cap.
function AddAllButton({
  picks,
  slipCount,
  addLeg,
  removeLeg,
  hasLeg,
}: {
  picks: ParsedPick[];
  slipCount: number;
  addLeg: (leg: ParsedPick) => boolean;
  removeLeg: (id: string) => void;
  hasLeg: (game: string, market: string, pick: string) => boolean;
}) {
  const colors = useColors();
  const inSlip = picks.filter((p) => hasLeg(p.game, p.market, p.pick)).length;
  const remaining = picks.length - inSlip;
  const allIn = remaining === 0;
  const slotsLeft = Math.max(0, MAX_LEGS - slipCount);
  // How many of the not-yet-added legs the slip can actually take right now.
  const willFit = Math.min(remaining, slotsLeft);
  const slipFull = !allIn && slotsLeft === 0;

  const onPress = () => {
    if (allIn) {
      // Remove every leg of this parlay from the slip in one tap. The id matches
      // BetSlipContext's legKey(game, market, pick) so removeLeg targets the
      // right entry.
      for (const p of picks) {
        removeLeg(`${p.game}|${p.market}|${p.pick}`.toLowerCase());
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }
    if (slipFull) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Slip full", `Your slip is at the ${MAX_LEGS}-leg max. Remove a leg to add more.`);
      return;
    }
    let added = 0;
    for (const p of picks) {
      if (hasLeg(p.game, p.market, p.pick)) continue;
      if (addLeg(p)) added++;
    }
    Haptics.impactAsync(
      added > 0 ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
    );
    // If the cap stopped us short of every leg, say exactly how many landed so a
    // partial add never looks like a glitch.
    if (added < remaining) {
      Alert.alert(
        "Slip full",
        added > 0
          ? `Added ${added} of ${remaining} — your slip is now at the ${MAX_LEGS}-leg max.`
          : `Your slip is at the ${MAX_LEGS}-leg max. Remove a leg to add more.`,
      );
    }
  };

  const label = allIn
    ? `Remove all ${picks.length} from slip`
    : slipFull
      ? `Slip full · ${MAX_LEGS} max`
      : willFit < remaining
        ? `Add ${willFit} (slip max ${MAX_LEGS})`
        : inSlip > 0
          ? `Add ${remaining} more to slip`
          : `Add all ${picks.length} to slip`;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        paddingVertical: 11,
        borderRadius: 10,
        backgroundColor: allIn || slipFull ? colors.card : colors.accent,
        borderWidth: allIn || slipFull ? 1 : 0,
        borderColor: colors.border,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <Feather
        name={allIn ? "x-circle" : slipFull ? "alert-circle" : "plus-circle"}
        size={15}
        color={allIn || slipFull ? colors.mutedForeground : colors.background}
      />
      <Text
        style={{
          color: allIn || slipFull ? colors.foreground : colors.background,
          fontFamily: FONT.bold,
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function CoachScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { legs, results, setAiPicks, addLeg, removeLeg, hasLeg } = useBetSlip();
  const { captureFromCoach, picks: trackedPicks } = usePickTracker();
  // Soft, real-data-only signal about which bet categories the model has actually
  // been hitting (from the user's graded Model Report). Injected into every chat
  // context so the Coach can lean into hot categories — advisory only, omitted
  // when nothing has settled. Recomputed only when the results ledger changes.
  const modelStrengths = useMemo(() => computeModelStrengths(results), [results]);
  // Real settled hit-rate per market family, from the SAME results ledger the
  // Model Report uses. Feeds the market-weighting layer so a market above/below
  // the user's historical thresholds nudges its legs' Confidence (real data only;
  // markets without a sufficient sample contribute nothing). Recomputed only when
  // the ledger changes.
  const marketPerf = useMemo(
    () => perfMapFromByFamily(computeAnalytics(results).byFamily),
    [results],
  );
  const modelCalibration = useMemo(() => calibrationFromTrackedPicks(results), [results]);
  const slipClearance = useCoachSlipClearance();
  const router = useRouter();
  const params = useLocalSearchParams<{
    prefill?: string;
    autoMsg?: string;
    send?: string;
    silent?: string;
    ts?: string;
    buildId?: string;
  }>() ?? {};
  const autoSentRef = useRef<string | null>(null);
  // Signed-in state gates the background-finish path (the server stashes the
  // result + pushes under the user's account; anonymous users can't be reached).
  const { isSignedIn } = useAuth();

  // Tap a chat pick card → open its real stats sheet: the player's game-log
  // breakdown for a prop, or the picked team's matchup page for a game-level
  // leg (ML/spread). Returns undefined when there's no single-subject sheet to
  // show (game totals name no team; props with no player identifier) so the card
  // stays non-tappable instead of promising a breakdown it can't deliver.
  const statsHandlerFor = useCallback(
    (p: ParsedPick): (() => void) | undefined => {
      if (p.isProp) {
        if (!p.player && !p.athleteId) return undefined;
        return () =>
          router.push({
            pathname: "/prop/[id]",
            params: {
              id: p.athleteId ?? p.player ?? "prop",
              player: p.player ?? "",
              marketKey: p.propMarketKey ?? "",
              marketLabel: p.market,
              line: p.propLine != null ? String(p.propLine) : "",
              side: p.propSide ?? "",
              odds: String(p.odds),
              game: p.game,
              sport: p.sport ?? "",
              athleteId: p.athleteId ?? "",
              headshot: p.headshot ?? "",
              startsAt: p.startsAt ?? "",
              pick: p.pick,
            },
          });
      }
      const side = gameSideFromPick(p);
      if (side && p.sport) {
        return () =>
          router.push({
            pathname: "/team-pick/[id]",
            params: {
              id: side.name,
              team: side.name,
              opp: side.opp,
              isHome: side.isHome ? "1" : "0",
              sport: p.sport ?? "",
              market: p.market,
              line: side.line != null ? String(side.line) : "",
              odds: String(p.odds),
              game: p.game,
              startsAt: p.startsAt ?? "",
              pick: p.pick,
            },
          });
      }
      // Game total ("Over/Under 214.5") names no single team — open the matchup
      // stats sheet showing BOTH sides' real scoring instead of side-guessing.
      const total = gameTotalFromPick(p);
      if (total && p.sport) {
        return () =>
          router.push({
            pathname: "/team-pick/[id]",
            params: {
              id: `${total.away}__${total.home}`,
              kind: "total",
              away: total.away,
              home: total.home,
              totalSide: total.side,
              sport: p.sport ?? "",
              market: p.market,
              line: total.line != null ? String(total.line) : "",
              odds: String(p.odds),
              game: p.game,
              startsAt: p.startsAt ?? "",
              pick: p.pick,
            },
          });
      }
      return undefined;
    },
    [router],
  );

  const [messages, setMessages] = useState<UIMessage[]>([]);
  const persistedExcludedSportsRef = useRef<Set<string>>(new Set());
  const excludedSportsHydratedRef = useRef(false);
  const [input, setInput] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [buildFinishing, setBuildFinishing] = useState(false);
  const [parlayBuildPhase, setParlayBuildPhase] = useState<ParlayBuildPhase | "idle">("idle");
  const [boardScanPartialLegs, setBoardScanPartialLegs] = useState(0);
  const [boardScanAwaiting, setBoardScanAwaiting] = useState(false);
  const [boardScanLiveProgress, setBoardScanLiveProgress] =
    useState<BoardScanLiveProgress | null>(null);
  const activeBoardScanProgress = useMemo((): BoardScanLiveProgress | null => {
    if (boardScanLiveProgress) return boardScanLiveProgress;
    if (boardScanPartialLegs > 0) {
      return {
        gamesLoaded: 1,
        propsAnalyzed: 1,
        marketsScanned: 1,
        simRunning: boardScanAwaiting,
        scanComplete: !boardScanAwaiting,
        picksReady: boardScanPartialLegs,
      };
    }
    if (boardScanAwaiting || parlayBuildPhase === "board-scan") {
      return {
        gamesLoaded: 0,
        propsAnalyzed: 0,
        marketsScanned: 0,
        simRunning: true,
        scanComplete: false,
        picksReady: 0,
      };
    }
    return null;
  }, [boardScanLiveProgress, boardScanPartialLegs, boardScanAwaiting, parlayBuildPhase]);
  const [buildProgressExpired, setBuildProgressExpired] = useState(false);
  const buildProgressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buildStallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A photo the user has attached (bet slip / sportsbook screenshot) but not yet
  // sent. `uri` is the local preview; `dataUrl` is the compressed base64 sent to
  // the vision model.
  const [attachedImages, setAttachedImages] = useState<{ uri: string; dataUrl: string }[]>([]);
  const [pickingImage, setPickingImage] = useState(false);
  // The most recently SENT slip photo(s), kept so a follow-up "give me a better
  // one" (which carries no fresh image) can silently re-attach them — the model
  // needs to re-read the slip to keep the SAME games / SAME leg count. Cleared
  // only when a new image is sent (it becomes the new remembered slip).
  const lastSlipImagesRef = useRef<string[]>([]);

  // Long-press a message bubble to copy its full text. The bubble text is also
  // `selectable` for partial copy via the OS menu, so this is a quick "copy all".
  const copyMessage = useCallback(async (text: string) => {
    const t = (text || "").trim();
    if (!t) return;
    try {
      await Clipboard.setStringAsync(t);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable — silently ignore */
    }
  }, []);

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);
  const scrollRef = useRef<ScrollView>(null);
  const composerInputRef = useRef<TextInput>(null);
  /** When false, the user scrolled up — don't fight them with scrollToEnd. */
  const autoScrollRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const simAbortRef = useRef<AbortController | null>(null);
  // Mirror of `streaming` readable synchronously from the AppState listener
  // (which can't see React state directly).
  const streamingRef = useRef(false);
  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);
  const buildFinishingRef = useRef(false);
  useEffect(() => {
    buildFinishingRef.current = buildFinishing;
  }, [buildFinishing]);
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const sendGenerationRef = useRef(0);
  const emptyScanTerminalFiredRef = useRef(false);
  const boardScanFinalByRequestRef = useRef<BoardScanFinalRegistry>(new Map());
  const flashEnrichRef = useRef<CoachFlashEnrich>({
    realOdds: [],
    propPool: [],
    gameMeta: [],
  });
  useEffect(() => {
    flashEnrichRef.current = { ...flashEnrichRef.current, perfByFamily: marketPerf };
  }, [marketPerf]);
  const otaCommitLabel = coachOtaCommitLabel();
  // The build currently eligible to be finished server-side if the app is
  // backgrounded (set when a signed-in parlay build starts; cleared when it
  // completes in-app). Holds the buildId tying it to the local PendingBuild.
  const pendingBgRef = useRef<{ buildId: string } | null>(null);
  // Set when we deliberately aborted the in-app stream to hand a build off to
  // the server (so the catch can show a "still building, I'll notify you" line
  // instead of a connection-error line).
  const handedOffRef = useRef(false);
  // buildIds we've already replayed, so a re-render / repeated AppState event
  // doesn't double-restore the same finished ticket.
  const restoredBuildRef = useRef<string | null>(null);
  // In-flight lock: restore can be triggered concurrently (poll + AppState
  // "active" + push tap). restoredBuildRef is checked BEFORE the async stash
  // fetch, so it can't prevent two interleaved calls from both replaying. This
  // ref serializes them — a second entrant bails until the first finishes.
  const restoringRef = useRef(false);
  // Drives a poll while a build is handed off to the server: it re-checks the
  // stash so a finished ticket replays (or a stalled one surfaces a retry) even
  // if the user just sits on the "still building" screen and never re-foregrounds.
  const [bgWatchId, setBgWatchId] = useState<string | null>(null);

  useEffect(() => {
    // autoMsg + send=1 never touch the composer — prefill is goCoach-only (edit before send).
    if (params.send === "1" || params.autoMsg) {
      setInput("");
      return;
    }
    if (params.prefill) setInput(String(params.prefill));
  }, [params.prefill, params.autoMsg, params.send]);

  // Seed the first assistant bubble with a first-time or returning welcome.
  // AsyncStorage is async (unlike web localStorage), so we set state after the
  // read; the functional update bails if a message already landed (e.g. an
  // auto-sent prefill that arrived first).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let returning = false;
      try {
        returning = (await AsyncStorage.getItem(CHAT_SEEN_KEY)) === "1";
        await AsyncStorage.setItem(CHAT_SEEN_KEY, "1");
      } catch {
        /* storage unavailable — treat as first time */
      }
      if (cancelled) return;
      setMessages((prev) => {
        if (prev.length === 0) {
          return [{ role: "assistant", content: returning ? WELCOME_RETURNING : WELCOME_FIRST_TIME }];
        }
        if (isOrphanCoachThread(prev, { streaming: false, buildFinishing: false })) {
          return recoverOrphanCoachThread(prev);
        }
        return prev;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void AsyncStorage.getItem(EXCLUDED_SPORTS_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          persistedExcludedSportsRef.current = new Set(JSON.parse(raw) as string[]);
        } catch {
          /* ignore corrupt storage */
        }
      })
      .catch(() => {})
      .finally(() => {
        excludedSportsHydratedRef.current = true;
      });
  }, []);

  const slipForContext = useMemo(
    () => legs.map((l) => ({ game: l.game, market: l.market, pick: l.pick, odds: l.odds })),
    [legs],
  );

  // animated=true for one-off jumps (after send, on finish). During streaming we
  // call this on every token; an ANIMATED scroll can't finish before the next
  // token fires another, so the view lags behind the growing text and the newest
  // lines spill below the fold ("overflowing as it's delivered"). Pass false
  // there for an instant scroll that pins the bottom on every chunk.
  const scrollToEnd = useCallback((animated: boolean = true) => {
    if (!autoScrollRef.current) return;
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated }));
  }, []);

  const onCoachScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    if (contentSize.height <= layoutMeasurement.height + 4) {
      autoScrollRef.current = true;
      return;
    }
    const distFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    autoScrollRef.current = distFromBottom < 96;
  }, []);

  const clearBuildStallWatchdog = useCallback(() => {
    if (buildStallTimerRef.current) {
      clearTimeout(buildStallTimerRef.current);
      buildStallTimerRef.current = null;
    }
  }, []);

  const boardTicketSnapshotRef = useRef<ParsedPick[] | null>(null);
  const latestBoardScanRef = useRef<FullBoardScanResult | null>(null);
  const earlyReachBoardScanRef = useRef<Promise<FullBoardScanResult | null> | null>(null);
  const activeParlayAskRef = useRef("");
  const varietySeedRef = useRef("");
  const coachRequestContextRef = useRef<CoachTicketRequestContext | null>(null);
  const activeRequestLegTargetRef = useRef(0);
  const liveScanDeliveredRef = useRef(false);
  const kernelParlayActiveRef = useRef(false);
  const boardScanInFlightRef = useRef(false);

  const clearParlayBuildUiFlags = useCallback(() => {
    setWaiting(false);
    setStreaming(false);
    setBuildFinishing(false);
    setBuildProgressExpired(false);
    setParlayBuildPhase("idle");
    setBoardScanPartialLegs(0);
    setBoardScanAwaiting(false);
    setBoardScanLiveProgress(null);
    boardScanInFlightRef.current = false;
    kernelParlayActiveRef.current = false;
    setCoachBuildBusy(false);
  }, []);

  const boardScanStillRunning = useCallback((): boolean => {
    if (boardScanInFlightRef.current) return true;
    const partial = latestBoardScanRef.current;
    return !!partial && !boardScanIsComplete(partial);
  }, []);

  const deliverCoachTicket = useCallback(
    (ticket: ParsedPick[], legNote?: string, opts?: { legTarget?: number; source?: string }): boolean => {
      const enrich = flashEnrichRef.current;
      let cleaned = prepareCoachDeliveredTicket(ticket, enrich);
      if (
        !cleaned.length &&
        ticket.length &&
        (opts?.source?.includes("board-scan") || opts?.source === "board-scan-fallback")
      ) {
        cleaned = coerceCoachDisplayPicks(ticket, enrich);
      }
      if (!cleaned.length) {
        logCoachPickDiag("delivery-result", {
          stage: "deliverCoachTicket-empty",
          source: opts?.source ?? "deliverCoachTicket",
          inputCount: ticket.length,
        });
        return false;
      }
      logCoachPickDiag("render-picks", {
        stage: "deliverCoachTicket",
        source: opts?.source ?? "deliverCoachTicket",
        pickCount: cleaned.length,
      });
      const legTarget =
        opts?.legTarget ??
        (activeRequestLegTargetRef.current ||
          requestedLegCount(activeParlayAskRef.current) ||
          effectiveBuildLegCount(activeParlayAskRef.current));
      const ctx = coachRequestContextRef.current;
      if (legTarget >= 3) {
        const finalized = finalizeCoachTicketForRequest(cleaned, {
          requestedLegs: legTarget,
          requestId: ctx?.requestId,
          previousRequestId: ctx?.previousRequestId,
          cacheKey: ctx?.cacheKey,
          source: opts?.source ?? "deliverCoachTicket",
          recordDelivered: true,
        });
        if (!finalized.ok) return false;
        boardTicketSnapshotRef.current = finalized.picks;
        patchLastAssistantPicks(setMessages, finalized.picks, legNote);
        setStreaming(false);
        setWaiting(false);
        setBuildFinishing(false);
        setBuildProgressExpired(false);
        setParlayBuildPhase("idle");
        setBoardScanAwaiting(false);
        setBoardScanLiveProgress(null);
        kernelParlayActiveRef.current = false;
        if (buildProgressTimerRef.current) {
          clearTimeout(buildProgressTimerRef.current);
          buildProgressTimerRef.current = null;
        }
        clearBuildStallWatchdog();
        setAiPicks(finalized.picks);
        captureFromCoach(finalized.picks);
        liveScanDeliveredRef.current = true;
        scrollToEnd(false);
        traceCoachPath("UI_RENDER_PICKS", {
          source: opts?.source ?? "deliverCoachTicket",
          pickCount: finalized.picks.length,
          requestId: ctx?.requestId,
        });
        return true;
      }
      boardTicketSnapshotRef.current = cleaned;
      patchLastAssistantPicks(setMessages, cleaned, legNote);
      setStreaming(false);
      setWaiting(false);
      setBuildFinishing(false);
      setBuildProgressExpired(false);
      setParlayBuildPhase("idle");
      if (buildProgressTimerRef.current) {
        clearTimeout(buildProgressTimerRef.current);
        buildProgressTimerRef.current = null;
      }
      clearBuildStallWatchdog();
      setAiPicks(cleaned);
      captureFromCoach(cleaned);
      scrollToEnd(false);
      traceCoachPath("UI_RENDER_PICKS", {
        source: opts?.source ?? "deliverCoachTicket",
        pickCount: cleaned.length,
        requestId: ctx?.requestId,
      });
      return true;
    },
    [clearBuildStallWatchdog, scrollToEnd],
  );

  const boardScanPartialToTicket = useCallback(
    (partial: FullBoardScanResult, enrichOverride?: CoachFlashEnrich, legTarget?: number) => {
      if (!partial.picks.length) return [] as ParsedPick[];
      const scanOdds = [...partial.evalLinesByGame.values()].flat();
      const base = enrichOverride ?? flashEnrichRef.current;
      const enrich: CoachFlashEnrich = {
        ...base,
        realOdds: [...base.realOdds, ...scanOdds],
        perfByFamily: base.perfByFamily ?? marketPerf,
      };
      const target =
        legTarget ??
        (requestedLegCount(activeParlayAskRef.current) ||
          effectiveBuildLegCount(activeParlayAskRef.current));
      if (boardScanIsComplete(partial)) {
        return deliverCoachBoardScanTicket(partial, enrich, target).picks;
      }
      return deliverCoachBoardScanProgress(partial, enrich, target).picks;
    },
    [marketPerf],
  );

  /** Terminal state: final scan complete, combinator produced zero candidates/picks. */
  const fireEmptyScanTerminal = useCallback(
    (
      partial: FullBoardScanResult,
      opts?: { legTarget?: number; enrich?: CoachFlashEnrich; pinScroll?: boolean },
    ): boolean => {
      if (emptyScanTerminalFiredRef.current) return true;
      if (!shouldFireEmptyScanTerminal(partial)) return false;

      emptyScanTerminalFiredRef.current = true;
      const enrich = opts?.enrich ?? flashEnrichRef.current;
      const scanOdds = [...partial.evalLinesByGame.values()].flat();
      const enrichWithScan = {
        ...enrich,
        realOdds: [...enrich.realOdds, ...scanOdds],
      };
      const legTarget =
        opts?.legTarget ??
        (requestedLegCount(activeParlayAskRef.current) ||
          effectiveBuildLegCount(activeParlayAskRef.current));
      const emptyReason = emptyReasonForScan(partial);
      const manifestNote = coachBoardScanManifestForMessage(
        partial,
        enrichWithScan,
        legTarget,
      );

      logEmptyScanTerminalFired(partial, emptyReason);
      latestBoardScanRef.current = partial;
      boardTicketSnapshotRef.current = [];
      boardScanInFlightRef.current = false;
      kernelParlayActiveRef.current = false;
      liveScanDeliveredRef.current = true;
      setBoardScanPartialLegs(0);
      setStreaming(false);
      setWaiting(false);
      setBuildFinishing(false);
      setBuildProgressExpired(false);
      setParlayBuildPhase("idle");
      setBoardScanAwaiting(false);
      setBoardScanLiveProgress(deriveBoardScanLiveProgress(partial, emptyReason));
      if (buildProgressTimerRef.current) {
        clearTimeout(buildProgressTimerRef.current);
        buildProgressTimerRef.current = null;
      }
      clearBuildStallWatchdog();
      setCoachBuildBusy(false);
      setMessages((prev) => {
        const copy = [...prev];
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i].role === "assistant") {
            copy[i] = {
              ...copy[i],
              picks: [],
              content: COACH_EMPTY_BOARD_SCAN_LEAD,
              legNote: emptyReason,
              coachDetailNote: manifestNote || undefined,
              retry: undefined,
              parlayBuild: true,
              ...(legTarget > 0 ? { ticketLegTarget: legTarget } : {}),
            };
            return copy;
          }
        }
        return prev;
      });
      setAiPicks([]);
      if (opts?.pinScroll !== false) scrollToEnd(false);
      return true;
    },
    [clearBuildStallWatchdog, scrollToEnd],
  );

  /** Flash board-scan legs onto the bubble without ending the in-flight build. */
  const patchInstantBoardScanTicket = useCallback(
    (
      partial: FullBoardScanResult,
      enrichOverride?: CoachFlashEnrich,
      opts?: { legNote?: string; ticketLegTarget?: number; pinScroll?: boolean },
    ) => {
      const enrich = enrichOverride ?? flashEnrichRef.current;
      const scanOdds = [...partial.evalLinesByGame.values()].flat();
      const enrichWithScan = {
        ...enrich,
        realOdds: [...enrich.realOdds, ...scanOdds],
      };
      const legTarget =
        opts?.ticketLegTarget ??
        (requestedLegCount(activeParlayAskRef.current) ||
          effectiveBuildLegCount(activeParlayAskRef.current));

      let ticket: ParsedPick[] = [];
      let legNote = opts?.legNote ?? partial.note;
      let coachDetailNote = "";

      if (boardScanIsComplete(partial)) {
        const delivered = deliverCoachBoardScanTicket(partial, enrichWithScan, legTarget);
        ticket = delivered.picks;
        coachDetailNote = delivered.coachDetailNote;
        if (!ticket.length && partial.picks.length) {
          ticket = boardScanToCoachTicket(partial, enrichWithScan, legTarget);
        }
        if (legTarget > 0 && ticket.length < legTarget) {
          legNote = ticket.length
            ? ensureFixedLegShortfallLegNote(legNote, legTarget, ticket.length)
            : buildFixedLegCountShortfallLead(legTarget, 0);
        } else if (!ticket.length) {
          legNote = legNote.trim() || partial.note;
        }
      } else {
        const progress = deliverCoachBoardScanProgress(partial, enrichWithScan, legTarget);
        ticket = progress.picks;
        if (!ticket.length) return false;
        legNote = progress.progressNote || legNote;
      }

      if (!ticket.length) {
        if (!boardScanIsComplete(partial)) return false;
        return fireEmptyScanTerminal(partial, {
          enrich: enrichWithScan,
          legTarget: legTarget > 0 ? legTarget : undefined,
          pinScroll: opts?.pinScroll,
        });
      }

      const ctx = coachRequestContextRef.current;
      const isFinal = boardScanIsComplete(partial);
      if (legTarget >= 3) {
        const finalized = finalizeCoachTicketForRequest(ticket, {
          requestedLegs: legTarget,
          requestId: ctx?.requestId,
          previousRequestId: ctx?.previousRequestId,
          cacheKey: ctx?.cacheKey,
          source: isFinal ? "final" : "preview",
          recordDelivered: isFinal,
        });
        if (!finalized.ok) {
          if (!ticket.length && partial.picks.length) {
            ticket = boardScanToCoachTicket(partial, enrichWithScan, legTarget);
          }
          if (!ticket.length) return false;
        } else {
          ticket = finalized.picks;
        }
      } else if (isFinal && legTarget > 0) {
        rememberParlayBuild(ticket);
        if (ctx) recordCoachTicketDelivered(ticket, ctx);
        liveScanDeliveredRef.current = true;
      }

      latestBoardScanRef.current = partial;
      boardTicketSnapshotRef.current = ticket;
      if (isFinal) liveScanDeliveredRef.current = true;
      setBoardScanPartialLegs(ticket.length);
      logCoachPickDiag("render-picks", {
        stage: isFinal ? "patch-final" : "patch-preview",
        pickCount: ticket.length,
        legTarget,
        scanComplete: partial.scanComplete ?? false,
      });
      if (boardScanIsComplete(partial)) {
        setStreaming(false);
        setWaiting(false);
        setBuildFinishing(false);
        setBuildProgressExpired(false);
        setParlayBuildPhase("idle");
        setBoardScanAwaiting(false);
        setBoardScanLiveProgress(null);
        kernelParlayActiveRef.current = false;
        if (buildProgressTimerRef.current) {
          clearTimeout(buildProgressTimerRef.current);
          buildProgressTimerRef.current = null;
        }
        clearBuildStallWatchdog();
      }
      setMessages((prev) => {
        const copy = [...prev];
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i].role === "assistant") {
            copy[i] = {
              ...copy[i],
              picks: ticket,
              content: "",
              ...(legNote.trim() ? { legNote: legNote.trim() } : {}),
              ...(coachDetailNote.trim() ? { coachDetailNote: coachDetailNote.trim() } : {}),
              ...(legTarget > 0 ? { ticketLegTarget: legTarget } : {}),
            };
            return copy;
          }
        }
        return prev;
      });
      setAiPicks(ticket);
      captureFromCoach(ticket);
      if (!isFinal && buildFinishingRef.current) {
        setParlayBuildPhase("stream");
      }
      if (opts?.pinScroll !== false) scrollToEnd(false);
      return true;
    },
    [clearBuildStallWatchdog, fireEmptyScanTerminal, scrollToEnd],
  );

  const rehydrateVisibleBoardTicket = useCallback(() => {
    const enrich = flashEnrichRef.current;
    if (
      !enrich.playerHistory &&
      !enrich.mlbPlatoon &&
      !enrich.mlbGameEnv &&
      !enrich.matchupHistory
    ) {
      return false;
    }
    const partial = latestBoardScanRef.current;
    if (partial?.picks?.length) {
      const legTarget =
        requestedLegCount(activeParlayAskRef.current) ||
        effectiveBuildLegCount(activeParlayAskRef.current);
      if (legTarget > 0 && !boardScanReadyForDelivery(partial, legTarget)) {
        return false;
      }
      return patchInstantBoardScanTicket(partial, enrich, {
        pinScroll: false,
        ticketLegTarget: legTarget > 0 ? legTarget : undefined,
      });
    }
    const snapshot = boardTicketSnapshotRef.current;
    if (!snapshot?.length) return false;
    const rescored = prepareCoachDeliveredTicket(
      rescoreCoachTicketPreservingLegs(snapshot, enrich),
      enrich,
    );
    if (!rescored.length) return false;
    boardTicketSnapshotRef.current = rescored;
    setMessages((prev) => {
      const copy = [...prev];
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].role === "assistant" && copy[i].picks?.length) {
          copy[i] = { ...copy[i], picks: rescored };
          return copy;
        }
      }
      return prev;
    });
    setAiPicks(rescored);
    captureFromCoach(rescored);
    return true;
  }, [captureFromCoach, patchInstantBoardScanTicket]);

  const tryInstantSlateSeedDelivery = useCallback(
    (legTarget: number, sport?: string | null) => {
      if (legTarget < 3) return false;
      const seed = readSlatePreAnalysisSeed({ legs: legTarget, sport });
      const scan = seed?.boardScan;
      if (!scan?.picks?.length) return false;
      if (!boardScanMatchesLegTarget(scan, legTarget)) return false;
      const enrich = coachFlashEnrichFromBuilt(seed.built, { perfByFamily: marketPerf });
      flashEnrichRef.current = enrich;
      return patchInstantBoardScanTicket(markBoardScanAsPreview(scan), enrich, {
        legNote: COACH_SLATE_PREVIEW_NOTE,
        ticketLegTarget: legTarget,
      });
    },
    [patchInstantBoardScanTicket, marketPerf],
  );

  const deliverBoardScanTicket = useCallback(
    (partial: FullBoardScanResult, enrichOverride?: CoachFlashEnrich) => {
      latestBoardScanRef.current = partial;
      const legTarget =
        requestedLegCount(activeParlayAskRef.current) ||
        effectiveBuildLegCount(activeParlayAskRef.current);
      const ticket = boardScanPartialToTicket(partial, enrichOverride);
      if (!ticket.length) {
        if (boardScanIsComplete(partial)) {
          patchInstantBoardScanTicket(partial, enrichOverride, { ticketLegTarget: legTarget });
        }
        return;
      }
      let legNote = partial.note;
      if (legTarget > ticket.length) {
        legNote = boardScanIsComplete(partial)
          ? ensureFixedLegShortfallLegNote(partial.note, legTarget, ticket.length)
          : `You asked for **${legTarget}** legs — showing **${ticket.length}** while the full-board scan continues.`;
      }
      if (boardScanIsComplete(partial)) {
        deliverCoachTicket(ticket, legNote);
      } else {
        patchInstantBoardScanTicket(partial, enrichOverride, { legNote, ticketLegTarget: legTarget });
      }
    },
    [boardScanPartialToTicket, deliverCoachTicket, patchInstantBoardScanTicket],
  );

  const deliverKernelBoardScan = useCallback(
    (
      scan: FullBoardScanResult | null | undefined,
      enrich: CoachFlashEnrich,
      legTarget: number,
    ): boolean => {
      if (!scan) return false;
      const { ticket, legNote } = resolveCoachParlayKernelTicket({
        scan,
        enrich,
        legTarget,
      });
      logCoachPickDiag("delivery-attempt", {
        stage: "deliverKernelBoardScan",
        legTarget,
        scanComplete: scan.scanComplete ?? false,
        rawPickCount: scan.picks.length,
        ticketCount: ticket.length,
      });
      if (ticket.length && deliverCoachTicket(ticket, legNote)) return true;
      if (boardScanIsComplete(scan) && scan.picks?.length) {
        const fallback = boardScanToCoachTicket(scan, enrich, legTarget);
        if (fallback.length && deliverCoachTicket(fallback, legNote, { source: "board-scan-fallback" })) {
          return true;
        }
      }
      if (boardScanIsComplete(scan)) {
        if (!ticket.length && fireEmptyScanTerminal(scan, { legTarget, enrich })) {
          return true;
        }
        return patchInstantBoardScanTicket(scan, enrich, { ticketLegTarget: legTarget });
      }
      if (scan.picks?.length) {
        deliverBoardScanTicket(scan, enrich);
        return !!boardTicketSnapshotRef.current?.length;
      }
      return false;
    },
    [deliverBoardScanTicket, deliverCoachTicket, fireEmptyScanTerminal, patchInstantBoardScanTicket],
  );

  /** Deliver stashed scan picks when the thread is ready but cards never landed. */
  const deliverPendingBoardScanIfReady = useCallback((): boolean => {
    if (boardTicketSnapshotRef.current?.length) return true;
    const legTarget =
      activeRequestLegTargetRef.current ||
      requestedLegCount(activeParlayAskRef.current) ||
      effectiveBuildLegCount(activeParlayAskRef.current);
    const requestId = coachRequestContextRef.current?.requestId;
    const scan = readBoardScanFinal(
      boardScanFinalByRequestRef.current,
      requestId,
      preferFinalBoardScanForDelivery(legTarget, latestBoardScanRef.current),
      latestBoardScanRef.current,
    );
    logDeliveryPoll(requestId, scan);
    if (!scan) return false;
    if (
      legTarget > 0 &&
      boardScanIsComplete(scan) &&
      !boardScanMatchesLegTarget(scan, legTarget) &&
      (scan.picks?.length ?? 0) < legTarget
    ) {
      return false;
    }
    logCoachPickDiag("delivery-attempt", {
      stage: "deliverPendingBoardScanIfReady",
      legTarget,
      scanComplete: scan.scanComplete ?? false,
      pickCount: scan.picks.length,
    });
    const enrich = {
      ...flashEnrichRef.current,
      realOdds: [
        ...flashEnrichRef.current.realOdds,
        ...[...scan.evalLinesByGame.values()].flat(),
      ],
    };
    if (boardScanIsComplete(scan)) {
      if (!scan.picks?.length) {
        if (fireEmptyScanTerminal(scan, { legTarget, enrich })) return true;
        patchInstantBoardScanTicket(scan, enrich, {
          ticketLegTarget: legTarget > 0 ? legTarget : undefined,
        });
        return emptyScanTerminalFiredRef.current;
      }
      if (scan.picks?.length) {
        if (
          (kernelParlayActiveRef.current || isParlayBuildAsk(activeParlayAskRef.current)) &&
          deliverKernelBoardScan(scan, enrich, legTarget)
        ) {
          return true;
        }
        deliverBoardScanTicket(scan, enrich);
        if (boardTicketSnapshotRef.current?.length) return true;
        if (
          patchInstantBoardScanTicket(scan, enrich, {
            ticketLegTarget: legTarget > 0 ? legTarget : undefined,
          })
        ) {
          return true;
        }
        logCoachPickDiag("delivery-result", {
          stage: "deliverPendingBoardScanIfReady-blocked",
          legTarget,
          scanRequestedLegs: scan.requestedLegs,
          pickCount: scan.picks.length,
        });
        return false;
      }
    }
    if (scan.picks?.length) {
      deliverBoardScanTicket(scan, enrich);
      if (boardTicketSnapshotRef.current?.length) return true;
      return patchInstantBoardScanTicket(scan, enrich, {
        ticketLegTarget: legTarget > 0 ? legTarget : undefined,
      });
    }
    return false;
  }, [deliverBoardScanTicket, deliverKernelBoardScan, fireEmptyScanTerminal, patchInstantBoardScanTicket]);

  /** When an early/async board scan settles after send() returns, deliver or show honest empty. */
  const watchBoardScanCompletion = useCallback(
    (
      promise: Promise<FullBoardScanResult | null> | null | undefined,
      sendGen: number,
      opts?: { earlyScan?: boolean },
    ) => {
      if (!promise) return;
      void promise
        .then((result) => {
          if (sendGenerationRef.current !== sendGen) return;
          const legTarget =
            activeRequestLegTargetRef.current ||
            requestedLegCount(activeParlayAskRef.current) ||
            effectiveBuildLegCount(activeParlayAskRef.current);

          if (result) {
            const keepLatest =
              (latestBoardScanRef.current?.picks?.length ?? 0) > (result.picks?.length ?? 0);
            const merged =
              preferFinalBoardScanForDelivery(legTarget, latestBoardScanRef.current, result) ??
              (keepLatest ? latestBoardScanRef.current : result);
            if (merged) {
              latestBoardScanRef.current = mergeBoardScanSnapshot(
                latestBoardScanRef.current,
                merged,
              );
              if (shouldFireEmptyScanTerminal(latestBoardScanRef.current)) {
                fireEmptyScanTerminal(latestBoardScanRef.current, {
                  legTarget: legTarget > 0 ? legTarget : undefined,
                });
                return;
              }
              setBoardScanLiveProgress(
                deriveBoardScanLiveProgress(latestBoardScanRef.current),
              );
            }
          }

          if (opts?.earlyScan) {
            const earlyEmpty =
              boardScanIsComplete(result ?? undefined) && !(result?.picks?.length ?? 0);
            const authoritative = preferFinalBoardScanForDelivery(
              legTarget,
              latestBoardScanRef.current,
              result,
            );
            if (
              earlyEmpty &&
              !authoritative?.picks?.length &&
              (boardScanStillRunning() ||
                (latestBoardScanRef.current?.picks?.length ?? 0) > 0)
            ) {
              logCoachPickDiag("delivery-result", {
                stage: "early-scan-deferred",
                pickCount: result?.picks?.length ?? 0,
                latestPicks: latestBoardScanRef.current?.picks?.length ?? 0,
              });
              return;
            }
          }

          const scan = preferFinalBoardScanForDelivery(
            legTarget,
            latestBoardScanRef.current,
            result,
          );
          if (!scan || !boardScanIsComplete(scan)) {
            setBoardScanAwaiting(!!scan && !boardScanIsComplete(scan));
            return;
          }

          boardScanInFlightRef.current = false;
          setBoardScanAwaiting(false);

          if (!deliverPendingBoardScanIfReady()) {
            const enrich = {
              ...flashEnrichRef.current,
              realOdds: [
                ...flashEnrichRef.current.realOdds,
                ...[...(scan.evalLinesByGame?.values() ?? [])].flat(),
              ],
            };
            if (
              (kernelParlayActiveRef.current || isParlayBuildAsk(activeParlayAskRef.current)) &&
              !boardTicketSnapshotRef.current?.length
            ) {
              deliverKernelBoardScan(scan, enrich, legTarget);
            }
          }

          if (buildProgressTimerRef.current) {
            clearTimeout(buildProgressTimerRef.current);
            buildProgressTimerRef.current = null;
          }
          clearBuildStallWatchdog();
          if (boardTicketSnapshotRef.current?.length || !(scan.picks?.length)) {
            clearParlayBuildUiFlags();
          }
          scrollToEnd(false);
        })
        .catch(() => {
          if (sendGenerationRef.current !== sendGen) return;
          if (boardScanStillRunning()) return;
          boardScanInFlightRef.current = false;
          setBoardScanAwaiting(false);
        });
    },
    [
      boardScanStillRunning,
      clearBuildStallWatchdog,
      clearParlayBuildUiFlags,
      deliverKernelBoardScan,
      deliverPendingBoardScanIfReady,
      fireEmptyScanTerminal,
      scrollToEnd,
    ],
  );

  const flashCoachTicketPicks = useCallback(
    (picks: ParsedPick[], legNote?: string, enrichOverride?: CoachFlashEnrich) => {
      const tagged = tagTicketRoles(picks);
      const enrich = enrichOverride ?? flashEnrichRef.current;
      const toShow = coachFlashTicketPicks(tagged, enrich);
      if (!toShow.length) return;
      deliverCoachTicket(toShow, legNote);
    },
    [deliverCoachTicket],
  );

  const armBuildProgressWatchdog = useCallback((legTarget = 0) => {
    if (buildProgressTimerRef.current) clearTimeout(buildProgressTimerRef.current);
    setBuildProgressExpired(false);
    const progressMs =
      legTarget >= 15 ? 180_000 : legTarget >= 9 ? 150_000 : legTarget >= 6 ? 120_000 : 25_000;
    buildProgressTimerRef.current = setTimeout(() => {
      setBuildProgressExpired(true);
      setMessages((prev) => scrubDeadBuildProseFromMessages(prev));
      scrollToEnd(false);
    }, progressMs);
  }, [scrollToEnd]);

  /** Board scans for reach-N parlays can run 90s+ — never abort mid-scan. */
  const armBuildStallWatchdog = useCallback(
    (sendGen: number, userText: string) => {
      clearBuildStallWatchdog();
      const legs = requestedLegCount(userText);
      const stallMs = buildStallBudgetMs(legs);
      buildStallTimerRef.current = setTimeout(() => {
        if (sendGenerationRef.current !== sendGen) return;
        if (boardScanInFlightRef.current || boardScanAwaiting) return;
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant" && !(last.picks?.length)) {
            const stallNote =
              "Still scanning every posted market — pick cards appear as each leg clears the quality bar.";
            copy[copy.length - 1] = {
              ...last,
              content: "",
              parlayBuild: true,
              legNote: last.legNote?.includes(stallNote) ? last.legNote : stallNote,
            };
          }
          return copy;
        });
        setParlayBuildPhase("board-scan");
        setBoardScanAwaiting(true);
        scrollToEnd(false);
      }, stallMs);
    },
    [clearBuildStallWatchdog, scrollToEnd, boardScanAwaiting],
  );

  const flashBoardScanResult = useCallback(
    (scan: FullBoardScanResult | null | undefined, enrichOverride?: CoachFlashEnrich) => {
      if (!scan?.picks?.length) return false;
      setBoardScanPartialLegs(scan.picks.length);
      return patchInstantBoardScanTicket(scan, enrichOverride);
    },
    [patchInstantBoardScanTicket],
  );

  const onBoardScanPartial = useCallback(
    (partial: FullBoardScanResult) => {
      const legTarget =
        activeRequestLegTargetRef.current ||
        requestedLegCount(activeParlayAskRef.current) ||
        effectiveBuildLegCount(activeParlayAskRef.current);
      const ctx = coachRequestContextRef.current;
      const sendGenNow = sendGenerationRef.current;
      const progressApplies =
        (ctx?.sendGeneration ?? sendGenNow) === sendGenNow &&
        (!ctx?.requestId || !partial.requestId || partial.requestId === ctx.requestId);
      if (progressApplies) {
        if (!boardScanIsComplete(partial) && partial.requestId) {
          const stashed = boardScanFinalByRequestRef.current.get(partial.requestId);
          if (stashed && boardScanIsComplete(stashed)) return;
        }
        latestBoardScanRef.current = mergeBoardScanSnapshot(
          latestBoardScanRef.current,
          partial,
        );
        if (boardScanIsComplete(partial) && partial.requestId) {
          stashBoardScanFinal(boardScanFinalByRequestRef.current, partial);
        }
        if (shouldFireEmptyScanTerminal(partial)) {
          fireEmptyScanTerminal(partial, {
            legTarget: legTarget > 0 ? legTarget : undefined,
          });
          return;
        }
        const emptyReason = boardScanIsComplete(partial) && !partial.picks.length
          ? emptyReasonForScan(partial)
          : undefined;
        setBoardScanLiveProgress(deriveBoardScanLiveProgress(partial, emptyReason));
        setBoardScanAwaiting(!boardScanIsComplete(partial));
        if (partial.picks.length) {
          setBoardScanPartialLegs(partial.picks.length);
        }
      }
      if (
        !boardScanAppliesToRequest(
          partial,
          legTarget,
          ctx?.sendGeneration ?? sendGenNow,
          sendGenNow,
          ctx?.requestId,
        )
      ) {
        traceCoachTicket("board-scan-staged", {
          requestedLegs: legTarget,
          scanRequestedLegs: partial.requestedLegs,
          pickIds: partial.picks,
          source: "partial-rejected-stale",
          extra: {
            requestId: ctx?.requestId,
            previousRequestId: ctx?.previousRequestId,
            sendGen: sendGenNow,
            expectedSendGen: ctx?.sendGeneration,
          },
        });
        if (boardScanIsComplete(partial) && progressApplies) {
          boardScanInFlightRef.current = false;
          if (!boardTicketSnapshotRef.current?.length) {
            if (shouldFireEmptyScanTerminal(partial)) {
              fireEmptyScanTerminal(partial, { legTarget: legTarget > 0 ? legTarget : undefined });
            } else {
              deliverPendingBoardScanIfReady();
            }
          }
        }
        return;
      }
      if (!boardScanIsComplete(partial)) {
        setParlayBuildPhase("board-scan");
        setBuildFinishing(true);
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant" && (last.retry || last.content?.trim())) {
            copy[copy.length - 1] = {
              ...last,
              content: "",
              retry: undefined,
            };
          }
          return copy;
        });
      }
      if (partial.picks.length) {
        setBoardScanPartialLegs(partial.picks.length);
        setParlayBuildPhase("stream");
      }
      if (boardScanIsComplete(partial) && kernelParlayActiveRef.current) {
        const enrich = {
          ...flashEnrichRef.current,
          realOdds: [
            ...flashEnrichRef.current.realOdds,
            ...[...partial.evalLinesByGame.values()].flat(),
          ],
        };
        if (deliverKernelBoardScan(partial, enrich, legTarget)) {
          setBoardScanAwaiting(false);
          setBoardScanLiveProgress(null);
          kernelParlayActiveRef.current = false;
          boardScanInFlightRef.current = false;
          return;
        }
      }
      if (boardScanIsComplete(partial)) {
        boardScanInFlightRef.current = false;
        if (!boardTicketSnapshotRef.current?.length) {
          if (shouldFireEmptyScanTerminal(partial)) {
            fireEmptyScanTerminal(partial, { legTarget: legTarget > 0 ? legTarget : undefined });
            return;
          }
          deliverPendingBoardScanIfReady();
        }
      }
      if (partial.picks.length || boardScanIsComplete(partial)) {
        patchInstantBoardScanTicket(partial, undefined, {
          ticketLegTarget: legTarget > 0 ? legTarget : undefined,
        });
      }
      const ask = activeParlayAskRef.current;
      if (ask && sendGenerationRef.current > 0) {
        armBuildStallWatchdog(sendGenerationRef.current, ask);
      }
    },
    [fireEmptyScanTerminal, patchInstantBoardScanTicket, armBuildStallWatchdog, deliverKernelBoardScan, deliverPendingBoardScanIfReady],
  );

  const kickoffEarlyReachBoardScan = useCallback(
    (opts: {
      target: number;
      sportScopeText: string;
      excludedSports: Set<string>;
      seedBuilt?: {
        context: ChatContext;
        propPool: PropPoolEntry[];
        gameMeta: GameMeta[];
      };
      signal?: AbortSignal;
    }) => {
      const { target, sportScopeText, excludedSports, seedBuilt, signal } = opts;
      const scanSports = coachBuildSports(sportScopeText, target, DEFAULT_SPORTS).filter(
        (s) => !excludedSports.has(s),
      );
      return (async (): Promise<FullBoardScanResult | null> => {
        try {
          setParlayBuildPhase("board-scan");
          const [espnGames, oddsGames, liveFeed] = await Promise.all([
            Promise.all(scanSports.map((s) => getGames(s, signal).catch(() => []))).then((rows) =>
              rows.flat(),
            ),
            Promise.all(scanSports.map((s) => getOdds(s, signal).catch(() => []))).then((rows) =>
              filterBettableOddsGames(rows.flat()),
            ),
            getLiveOdds(scanSports, signal).catch(() => ({ games: [], odds: [] })),
          ]);
          if (seedBuilt) {
            flashEnrichRef.current = coachFlashEnrichFromBuilt(
              {
                context: seedBuilt.context,
                propPool: seedBuilt.propPool,
                gameMeta: seedBuilt.gameMeta,
              },
              { perfByFamily: marketPerf },
            );
          }
          const reachTarget = Math.min(target, MAX_LEGS);
          boardScanInFlightRef.current = true;
          setBoardScanAwaiting(true);
          return await tryReachFullBoardScan({
              target: reachTarget,
              oddsGames,
              propPool: seedBuilt?.propPool ?? [],
              realOdds: seedBuilt?.context.realOdds ?? [],
              liveOdds: liveFeed.odds,
              espnGames,
              gameMeta: seedBuilt?.gameMeta ?? [],
              teamIdMap: buildGameTeamIdMap(espnGames),
              excludedSports,
              matchupHistory: seedBuilt?.context.matchupHistory,
              matchupInjuries: seedBuilt?.context.matchupInjuries,
              playerHistory: seedBuilt?.context.playerHistory as
                | Record<string, PlayerHistorySlice>
                | undefined,
              mlbPlatoon: seedBuilt?.context.mlbPlatoon,
              mlbGameEnv: seedBuilt?.context.mlbGameEnv,
              perfByFamily: marketPerf,
              calibration: modelCalibration,
              onPartial: onBoardScanPartial,
              signal,
              requestId: coachRequestContextRef.current?.requestId,
              scanTimeoutMs: boardScanBudgetMs(reachTarget),
            });
        } catch {
          return null;
        }
      })();
    },
    [marketPerf, modelCalibration, onBoardScanPartial],
  );

  // Open the photo library and stash the chosen image as a pending attachment.
  // We downscale to <=1280px wide and JPEG-compress it so a phone screenshot
  // (often a multi-MB PNG) becomes a small base64 payload, well under the API's
  // 5MB body cap and fast for the vision model. launchImageLibraryAsync uses the
  // system photo picker, which needs no runtime permission on modern iOS/Android.
  const MAX_IMAGES = 3;
  const pickImage = useCallback(async () => {
    if (streaming || buildFinishing || pickingImage) return;
    const remaining = MAX_IMAGES - attachedImages.length;
    if (remaining <= 0) return;
    try {
      setPickingImage(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 1,
      });
      if (result.canceled || !result.assets?.length) return;
      // Downscale + JPEG-compress each selection (a screenshot is often a multi-MB
      // PNG) so the combined base64 payload stays well under the API body cap.
      const picked = result.assets.slice(0, remaining);
      const processed: { uri: string; dataUrl: string }[] = [];
      for (const asset of picked) {
        if (!asset.uri) continue;
        const actions = asset.width && asset.width > 1024 ? [{ resize: { width: 1024 } }] : [];
        const out = await ImageManipulator.manipulateAsync(asset.uri, actions, {
          compress: 0.55,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        });
        if (!out.base64) continue;
        processed.push({ uri: out.uri, dataUrl: `data:image/jpeg;base64,${out.base64}` });
      }
      if (processed.length) {
        setAttachedImages((prev) => [...prev, ...processed].slice(0, MAX_IMAGES));
      }
    } catch {
      /* picker/manipulation failed — leave any existing attachments unchanged */
    } finally {
      setPickingImage(false);
    }
  }, [streaming, buildFinishing, pickingImage, attachedImages.length]);

  const send = useCallback(
    async (
      text: string,
      opts?: {
        // Replay mode: a build the server FINISHED in the background while the
        // app was away. Instead of fetching context + streaming the model, we
        // render the stashed reply against the locally-saved context (the same
        // odds/props/matchups the model used). Nothing is re-fetched or invented.
        replay?: {
          full: string;
          props: RealPropEntry[];
          context: ChatContext;
          propPool: PropPoolEntry[];
          gameMeta: GameMeta[];
          todayOnly: boolean;
        };
        hideUserBubble?: boolean;
        /** Shorter bubble copy; the full `text` still goes to the model. */
        userBubble?: string;
        /** Drop prior Coach thread — Home hero / one-tap shortcuts start clean. */
        freshThread?: boolean;
      },
    ) => {
      const replay = opts?.replay ?? null;
      const trimmed = text.trim();
      const images = replay ? [] : attachedImages;
      const parlayPreempt = isParlayBuildAsk(trimmed);
      const mayInterrupt = !!opts?.freshThread || parlayPreempt;
      if (
        (!trimmed && !images.length) ||
        ((streamingRef.current || buildFinishingRef.current) && !mayInterrupt)
      ) {
        return;
      }

      const sendGen = ++sendGenerationRef.current;
      emptyScanTerminalFiredRef.current = false;
      boardScanFinalByRequestRef.current.clear();
      autoScrollRef.current = true;
      boardTicketSnapshotRef.current = null;
      latestBoardScanRef.current = null;
      earlyReachBoardScanRef.current = null;
      coachRequestContextRef.current = null;
      activeRequestLegTargetRef.current = 0;
      liveScanDeliveredRef.current = false;
      kernelParlayActiveRef.current = false;
      setBoardScanPartialLegs(0);
      setBoardScanAwaiting(false);
      setBoardScanLiveProgress(null);
      setAiPicks([]);

      const resetInFlightBuild = () => {
        abortRef.current?.abort();
        simAbortRef.current?.abort();
        boardTicketSnapshotRef.current = null;
        latestBoardScanRef.current = null;
        earlyReachBoardScanRef.current = null;
        coachRequestContextRef.current = null;
        activeRequestLegTargetRef.current = 0;
        liveScanDeliveredRef.current = false;
        if (buildProgressTimerRef.current) {
          clearTimeout(buildProgressTimerRef.current);
          buildProgressTimerRef.current = null;
        }
        clearBuildStallWatchdog();
        setBuildFinishing(false);
        setStreaming(false);
        setWaiting(false);
        setBuildProgressExpired(false);
        setParlayBuildPhase("idle");
        setBoardScanAwaiting(false);
        setBoardScanLiveProgress(null);
        kernelParlayActiveRef.current = false;
      };
      if (mayInterrupt) {
        resetInFlightBuild();
        stopSlatePreAnalysis();
      }

      // Drop the keyboard once a message is actually sent so the reply isn't
      // hidden behind it (covers the send button, suggested prompts, auto-send).
      Keyboard.dismiss();
      setInput("");
      setAttachedImages([]);
      // A brand-new message supersedes any prior handed-off build's poll, so stop
      // that watcher (the new send manages its own hand-off/watch below). A replay
      // already cleared it before reaching here.
      if (!replay) setBgWatchId(null);

      // Resolve the image(s) actually SENT to the vision model. A FRESH
      // attachment is sent as-is and remembered as the current slip. With NO
      // fresh image, an "improve this slip" follow-up ("give me a better one")
      // silently RE-ATTACHES the last uploaded slip so the model can re-read it
      // and keep the SAME games / SAME leg count — these are sent for context but
      // NOT shown again in the chat bubble (the user didn't re-attach anything).
      let outgoingImageDataUrls: string[] | undefined;
      if (images.length) {
        outgoingImageDataUrls = images.map((im) => im.dataUrl);
        lastSlipImagesRef.current = outgoingImageDataUrls;
      } else if (wantsImproveSlip(trimmed) && lastSlipImagesRef.current.length) {
        outgoingImageDataUrls = lastSlipImagesRef.current;
      }
      const hasOutgoingImages = !!outgoingImageDataUrls?.length;

      const priorThread = opts?.freshThread
        ? []
        : messages.filter((m) => !isWelcomeMessage(m));
      const restartParlayThread =
        isParlayBuildAsk(trimmed) &&
        !opts?.freshThread &&
        priorThread.some(isEmptyParlayScanReply);
      const thread = pruneDeadParlayPlaceholders(
        scrubDeadBuildProseFromMessages(
          restartParlayThread ? [] : prunePriorEmptyParlayReplies(priorThread),
        ),
      );
      const history: UIMessage[] = [
        ...thread,
        {
          role: "user",
          content: opts?.userBubble ?? trimmed,
          apiContent: opts?.userBubble && opts.userBubble !== trimmed ? trimmed : undefined,
          imageUris: images.length ? images.map((im) => im.uri) : undefined,
          hideBubble: opts?.hideUserBubble,
        },
      ];
      // A "scan/analyze my ticket" ask shows a Ticket Scan summary card above the
      // streamed breakdown. Snapshot the slip NOW (with each leg's edge note) so
      // the card's real metrics stay correct even if the slip later changes.
      const analyzeSlipSnapshot: TicketScanLeg[] | undefined =
        wantsAnalyzeSlip(trimmed) && legs.length
          ? legs.map((l) => ({ pick: l.pick, odds: l.odds, edge: l.edge }))
          : undefined;
      const openingParlayBuild = isParlayBuildAsk(trimmed) && !analyzeSlipSnapshot;
      const earlyLegTarget = openingParlayBuild
        ? requestedLegCount(trimmed) || effectiveBuildLegCount(trimmed)
        : 0;
      const slateSportScope = focalSportsFromText(
        [...messages.filter((m) => m.role === "user").map((m) => m.content), trimmed].join(" "),
      );
      const slateSport = slateSportScope.size === 1 ? [...slateSportScope][0]! : null;
      const slateSeedOpts = {
        legs: earlyLegTarget || undefined,
        sport: slateSport,
      };
      let openingPicks: ParsedPick[] | undefined;
      let openingLegNote: string | undefined;
      if (openingParlayBuild) {
        await hydrateSlatePreAnalysisCache();
        void hydrateCoachSlateFromServer(slateSeedOpts);
        const seed = readSlatePreAnalysisSeed(slateSeedOpts);
        if (seed?.boardScan?.picks?.length) {
          const enrich = coachFlashEnrichFromBuilt(seed.built, { perfByFamily: marketPerf });
          flashEnrichRef.current = enrich;
          const ticket = boardScanPartialToTicket(
            markBoardScanAsPreview(seed.boardScan),
            enrich,
            earlyLegTarget || undefined,
          );
          if (ticket.length) {
            const prepared = prepareCoachDeliveredTicket(ticket, enrich);
            if (
              earlyLegTarget > 0 &&
              rejectPrefixOfLastDelivered(prepared, earlyLegTarget)
            ) {
              traceCoachTicket("mobile-delivered", {
                requestedLegs: earlyLegTarget,
                pickIds: prepared,
                source: "rejected-opening-preview-prefix",
              });
            } else {
              openingPicks = prepared;
            }
          }
          if (openingPicks?.length) {
            openingLegNote = COACH_SLATE_PREVIEW_NOTE;
          }
        }
        void startSlatePreAnalysis("coach-send", slateSeedOpts);
      }
      if (sendGenerationRef.current !== sendGen) return;
      setMessages([
        ...history,
        {
          role: "assistant",
          content: "",
          ...(analyzeSlipSnapshot ? { analyzeSlip: analyzeSlipSnapshot } : {}),
          ...(openingParlayBuild ? { parlayBuild: true, retry: undefined } : {}),
          ...(openingPicks?.length
            ? {
                picks: openingPicks,
                legNote: openingLegNote,
                ...(earlyLegTarget > 0 ? { ticketLegTarget: earlyLegTarget } : {}),
              }
            : {}),
        },
      ]);
      if (openingPicks?.length) {
        boardTicketSnapshotRef.current = openingPicks;
        setAiPicks(openingPicks);
        setParlayBuildPhase("stream");
      }
      setWaiting(true);
      setStreaming(true);
      if (openingParlayBuild) {
        activeParlayAskRef.current = trimmed;
        setCoachBuildBusy(true);
        setBuildFinishing(true);
        setParlayBuildPhase(openingPicks?.length ? "stream" : "context");
        armBuildProgressWatchdog(earlyLegTarget);
        armBuildStallWatchdog(sendGen, trimmed);
      }
      const releaseOtaBlock = blockOtaReload();
      scrollToEnd();

      if (!excludedSportsHydratedRef.current) {
        try {
          const raw = await AsyncStorage.getItem(EXCLUDED_SPORTS_KEY);
          if (raw) persistedExcludedSportsRef.current = new Set(JSON.parse(raw) as string[]);
        } catch {
          /* ignore corrupt storage */
        }
        excludedSportsHydratedRef.current = true;
      }
      if (sendGenerationRef.current !== sendGen) {
        releaseOtaBlock();
        setCoachBuildBusy(false);
        setWaiting(false);
        setStreaming(false);
        setBuildFinishing(false);
        return;
      }

      // Fresh entropy each send so identical prompts (e.g. "15-leg longshot") don't
      // replay the same ranked props and game-line walk order every tap.
      const varietySeed = makeBuildId();
      varietySeedRef.current = varietySeed;
      if (openingParlayBuild && earlyLegTarget >= 3) {
        activeRequestLegTargetRef.current = earlyLegTarget;
        coachRequestContextRef.current = startCoachTicketRequest({
          requestId: varietySeed,
          sendGeneration: sendGen,
          requestedLegs: earlyLegTarget,
          sport: slateSport,
          varietySeed,
        });
      }

      const controller = new AbortController();
      abortRef.current = controller;

      if (openingParlayBuild) {
        // Cached slate may flash as a preview only — final picks come from a fresh scan.
        tryInstantSlateSeedDelivery(earlyLegTarget, slateSport);
      }

      // Card/booking asks have no feed — answer instantly instead of streaming guesses.
      if (!replay && !hasOutgoingImages && isUnsupportedSoccerDisciplineAsk(trimmed)) {
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            role: "assistant",
            content: unsupportedSoccerDisciplineReply(trimmed),
          };
          return copy;
        });
        setWaiting(false);
        setStreaming(false);
        abortRef.current = null;
        releaseOtaBlock();
        scrollToEnd();
        return;
      }

      // Stat-lookup interception: a player/stat question (e.g. "Wembanyama
      // points last 10 games") is answered with a REAL ESPN stat card or a
      // StatMuse period game-log card instead of streamed AI text. Any miss or
      // error falls through to the normal chat path, which never fabricates.
      try {
        // A photo attachment goes straight to the vision model — the text-only
        // stat-card lookup can't read an image, so skip it when one is attached.
        const card =
          replay || hasOutgoingImages || isCoachRecommendationQuestion(trimmed)
            ? null
            : await tryStatCard(trimmed, controller.signal);
        if (card) {
          const wantsProjection =
            isProjectionQuestion(trimmed) || isPitcherInningsWorkloadAsk(trimmed);
          setMessages((prev) => {
            const copy = [...prev];
            const payload = { ...card };
            if (wantsProjection && payload.statCard) {
              payload.statCard = { ...payload.statCard, expectProjection: true };
            }
            copy[copy.length - 1] = { role: "assistant", content: "", ...payload };
            return copy;
          });
          scrollToEnd();

          // A pure lookup ("Wembanyama points last 10 games") is fully answered
          // by the card above. But an opinion/projection question ("how many
          // points do you think he'll score tonight?") wants the coach's actual
          // take — stream a grounded answer on the SAME message, below the card.
          if (wantsProjection) {
            setWaiting(true);
            scrollToEnd();
            try {
              const { context } = await buildChatContext(
                DEFAULT_SPORTS,
                slipForContext,
                controller.signal,
                undefined,
                false,
                trimmed,
              );
              if (modelStrengths.length > 0) context.modelStrengths = modelStrengths;
              const grounded: ChatMessage[] = history.map((m) => ({
                role: m.role,
                content: m.apiContent ?? m.content,
              }));
              grounded[grounded.length - 1] = {
                role: "user",
                content: `${trimmed}\n\n${serializeStatCardForAI(card)}`,
              };
              let first = true;
              const full = await streamChat({
                messages: grounded,
                context,
                signal: controller.signal,
                onToken: (sofar) => {
                  if (first) {
                    first = false;
                    setWaiting(false);
                  }
                  setMessages((prev) => {
                    const copy = [...prev];
                    const last = copy[copy.length - 1];
                    copy[copy.length - 1] = { ...last, role: "assistant", content: sofar };
                    return copy;
                  });
                  scrollToEnd(false);
                },
              });
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                copy[copy.length - 1] = { ...last, role: "assistant", content: full };
                return copy;
              });
            } catch (e: any) {
              if (e?.name === "AbortError") {
                setMessages((prev) => {
                  const copy = [...prev];
                  const last = copy[copy.length - 1];
                  if (last?.role === "assistant" && !last.content?.trim()) {
                    copy[copy.length - 1] = { ...last, role: "assistant", content: "" };
                  }
                  return copy;
                });
              } else {
                setMessages((prev) => {
                  const copy = [...prev];
                  const last = copy[copy.length - 1];
                  copy[copy.length - 1] = {
                    ...last,
                    role: "assistant",
                    content:
                      "Those are the real numbers above — I couldn't add my projection just now. Try asking again.",
                  };
                  return copy;
                });
              }
            }
          }

          setWaiting(false);
          setStreaming(false);
          abortRef.current = null;
          releaseOtaBlock();
          scrollToEnd();
          return;
        }
      } catch (e: any) {
        if (e?.name === "AbortError" || isAbortLikeError(e)) {
          if (sendGenerationRef.current !== sendGen) return;
          if (openingParlayBuild) {
            const partial = latestBoardScanRef.current;
            if (partial?.picks?.length) {
              deliverBoardScanTicket(partial);
            } else {
              tryInstantSlateSeedDelivery(
                requestedLegCount(trimmed) || effectiveBuildLegCount(trimmed),
              );
            }
          }
          setWaiting(false);
          setStreaming(false);
          setBuildFinishing(false);
          abortRef.current = null;
          releaseOtaBlock();
          return;
        }
        // Non-abort errors: fall through to the AI chat path below.
      }

      try {
        // Odds-threshold ask ("10 leg with -300 or less"): parsed once and used
        // both to steer alt-rung selection in the context and to hard-filter the
        // resolved legs below.
        const oddsThreshold = parseOddsThreshold(trimmed);
        // Confidence-score ask ("5 leg with 9 to 10 confidence"). The Confidence
        // badge is BUILT from each leg's strong REAL signals (confidenceFromSignals
        // via attachPickScores), so this band is a floor on how many signals back a
        // leg. Parsed once: the server prompt steers the model toward picks with
        // several strong signals, and we hard-filter the resolved legs below by the
        // SAME signals score so every card truly meets the band — never inventing a
        // signal, honest-short if too few qualify.
        const confidenceThreshold = parseConfidenceThreshold(trimmed);
        // The number of legs the user explicitly asked for (0 when unspecified).
        // Computed up here (not just before the reach-N backstop below) because a
        // single-game high-leg ask needs it to decide includePeriods.
        const requestedLegs = requestedLegCount(trimmed);
        const buildLegs = effectiveBuildLegCount(trimmed);
        const legTarget = requestedLegs > 0 ? requestedLegs : buildLegs;
        const coachTicketStyle = detectCoachTicketStyle(trimmed);
        activeRequestLegTargetRef.current = legTarget;
        if (coachRequestContextRef.current) {
          coachRequestContextRef.current = {
            ...coachRequestContextRef.current,
            requestedLegs: legTarget,
          };
        } else if (legTarget >= 3) {
          coachRequestContextRef.current = startCoachTicketRequest({
            requestId: varietySeedRef.current || makeBuildId(),
            sendGeneration: sendGen,
            requestedLegs: legTarget,
            sport: slateSport,
            varietySeed: varietySeedRef.current,
          });
        }
        // Period/same-game ask ("2nd-half ticket", "Q3 legs", "same game"): surface
        // game-level period markets (1H/2H/Q1–Q4) in the context so the model has
        // real period legs to build from instead of honestly refusing.
        //
        // ALSO unlock periods for high-leg thin-slate asks even without explicit
        // period words. One remaining "tonight" game can only supply three
        // full-game mains (ML / spread / total), so a 15-leg tonight ask otherwise
        // stalls at ~3 even when real F5/1H/Q markets exist. Gated on a real leg
        // count plus either a single-game cue OR a today/tonight high-leg cue so
        // ordinary small generic builds stay lean.
        const singleGameDepth =
          requestedLegs >= 6 &&
          (/\bgame\s*#?\s*\d+\b/i.test(trimmed) ||
            /\b(this|that|the|one|single|same)\s+game\b/i.test(trimmed) ||
            /\bfor\s+[\w.&'’-]+\s+(?:@|vs\.?|versus|at|against)\s+[\w.&'’-]+/i.test(
              trimmed,
            ));
        const explicitSingleGame =
          explicitSingleGameIntent(trimmed) || singleGameDepth;
        const priorUserTexts = messages
          .filter((m) => m.role === "user")
          .map((m) => m.content);
        const soccerScorerGkAsk = wantsSoccerScorerGoalkeeperPicks(trimmed);
        const slateDay = soccerScorerGkAsk
          ? null
          : slateDayFromThread(trimmed, priorUserTexts);
        const slateLabel = slateOddsLabel(slateDay);
        const boardPhrase = slateDay ? `${slateLabel} board` : "the board";
        const thinSlateDepth = requestedLegs >= 9 && slateDay === "tonight";
        const explicitPeriodAsk = wantsPeriodMarkets(trimmed) || singleGameDepth;
        const focalForPools =
          slateDay === "tomorrow" && !wantsTomorrowOnly(trimmed)
            ? `${trimmed} tomorrow`
            : slateDay === "tonight" && !wantsTodayOnly(trimmed)
              ? `${trimmed} tonight`
              : trimmed;
        const excludedSports = resolveExcludedSports(priorUserTexts, trimmed, persistedExcludedSportsRef.current);
        try {
          const nextPersisted = [...excludedSports];
          persistedExcludedSportsRef.current = excludedSports;
          await AsyncStorage.setItem(EXCLUDED_SPORTS_KEY, JSON.stringify(nextPersisted));
        } catch {
          /* storage unavailable — in-memory exclusion still applies this send */
        }
        const excludeSportsList = excludedSports.size > 0 ? [...excludedSports] : undefined;
        const sportScopeText = [...priorUserTexts, trimmed].join(" ");
        const includePeriods = explicitPeriodAsk || thinSlateDepth;
        // Explicit "+ alt" / "- alt" sign ask. "+ alt" / "plus alt" forces every
        // leg onto plus-money rungs (aggressive upside); "- alt" / "minus alt"
        // forces minus-money rungs (safer cushion). The sign is recognised three
        // ways: (a) a LEADING sign on the whole message ("- 9 leg alt", "+9 leg
        // alt") — how users actually type it; (b) a sign right next to "alt" ("9 leg
        // +alt", "9 leg - alt"); (c) the words plus/minus. A leading sign must be
        // followed by a space or digit, and a "-" next to "alt" must be start- or
        // space-anchored, so a compound hyphen like "9-leg alt" never reads as a
        // minus ask. Only applies to an actual alt ask (altMentioned) and never
        // under an odds-threshold ask (that already implies the sign). Drives BOTH
        // game-level alt rung selection (altSign -> buildChatContext) and the prop
        // rung swap (altRungBias below).
        const altMentioned =
          /\balt(?:s|ernate|ernates|ernative|ernatives)?\b/i.test(trimmed);
        const plusCue =
          /^\s*\+(?=\s|\d)/.test(trimmed) ||
          /(?:\+|\bplus\b)\s*alt/i.test(trimmed) ||
          /\bplus\b/i.test(trimmed);
        const minusCue =
          /^\s*-(?=\s|\d)/.test(trimmed) ||
          /(?:(?:^|\s)-|\bminus\b)\s*alt/i.test(trimmed) ||
          /\bminus\b/i.test(trimmed);
        const wantsPlusAlt =
          !oddsThreshold && altMentioned && plusCue && !minusCue;
        const wantsMinusAlt =
          !oddsThreshold && altMentioned && minusCue && !plusCue;
        const altSign: AltSign = wantsPlusAlt ? "plus" : wantsMinusAlt ? "minus" : null;
        // Staged build progress: while the context fetch runs we cycle through the
        // first three labels (odds → value props → matchups — the real phases of
        // buildChatContext), capped at "Checking matchups". We jump to "Building
        // correlation" only once the data is actually in (below), and the render
        // promotes to "Finalizing parlay" once real PICK lines stream.
        const isParlayBuild = isParlayBuildAsk(trimmed);
        const useParlayKernel = coachParlayKernelSkipStream({
          isParlayBuild,
          isAnalyze: wantsAnalyzeSlip(trimmed),
          hasOutgoingImages: !!hasOutgoingImages,
          oddsThreshold: !!oddsThreshold,
          confidenceThreshold: !!confidenceThreshold,
        });
        let kernelParlayDelivered = false;

        // These are the same four pieces buildChatContext returns; in replay mode
        // we read them from the locally-saved PendingBuild instead of fetching.
        let context: ChatContext;
        let propPool: PropPoolEntry[];
        let gameMeta: GameMeta[];
        let todayOnly: boolean;
        let full: string;
        let propSimulations = new Map<string, { hitProbability: number | null }>();
        let selectionOpts: PropSelectionOpts | undefined;
        let preBoardScan: FullBoardScanResult | null = null;
        let didReachFullPreScan = false;
        let freshBoardScanComplete = false;
        // The server streams back the EXACT prop pool the model saw (post
        // market-lock filter + fresh-fetch backfill). The local propPool is capped
        // to the soonest games and can miss late-starting games, so without this
        // the matcher fail-closes a perfectly real later-game prop ticket. In
        // replay mode this is seeded from the stashed result. Real bookmaker rows
        // only — never fabricated.
        const serverPropPool: PropPoolEntry[] = [];

        if (replay) {
          // Background-finished build: reuse the saved context + stashed reply.
          context = replay.context;
          propPool = replay.propPool;
          gameMeta = replay.gameMeta;
          todayOnly = replay.todayOnly;
          full = replay.full;
          serverPropPool.push(...propPoolFromRealProps(replay.props));
          flashEnrichRef.current = coachFlashEnrichFromBuilt(
            { context, propPool, gameMeta },
            { perfByFamily: marketPerf },
          );
          setWaiting(false);
          if (!wantsAnalyzeSlip(trimmed)) {
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last?.role === "assistant") {
                const { legNote: _ln, ...rest } = last;
                copy[copy.length - 1] = { ...rest, content: "" };
              }
              return copy;
            });
          }
        } else {
          const buildSports = coachBuildSports(sportScopeText, buildLegs, DEFAULT_SPORTS);
          const focalSports = focalSportsFromText(sportScopeText);
          // Slip-photo verdict ("read this ticket") goes straight to the vision
          // model — skip the 30s+ odds/props/matchup fan-out that was connect-
          // stalling before /chat even opened on cellular.
          const slipImageVerdictOnly =
            hasOutgoingImages &&
            !isParlayBuild &&
            !wantsImproveSlip(trimmed) &&
            !oddsThreshold &&
            !confidenceThreshold &&
            !includePeriods;
          const fastParlay = isParlayBuild && buildLegs > 0 && buildLegs <= MAX_LEGS;
          const genericParlayPath =
            fastParlay &&
            !oddsThreshold &&
            !explicitPeriodAsk &&
            !wantsAnalyzeSlip(trimmed) &&
            !altSign &&
            focalSports.size === 0;
          // Named single-league parlays ("12 leg mlb") must not fall through to
          // full buildChatContext — that tier pulls ~500KB for 11+ legs and
          // connect-stalls before the stream opens on cellular.
          const useFocalSportParlayPath =
            fastParlay &&
            focalSports.size === 1 &&
            !oddsThreshold &&
            !confidenceThreshold &&
            !explicitPeriodAsk &&
            !wantsAnalyzeSlip(trimmed) &&
            !altSign;
          const focalSportId = useFocalSportParlayPath ? [...focalSports][0]! : null;
          // Props-only must never depend on genericParlayPath — a future focal-sport
          // false positive or gate tweak would otherwise fall through to full
          // buildChatContext and connect-stall on cellular.
          const usePropsOnlyParlayPath =
            isParlayBuild &&
            wantsPropsOnly(trimmed) &&
            buildLegs > 0 &&
            buildLegs <= MAX_LEGS &&
            !oddsThreshold &&
            !confidenceThreshold &&
            !explicitPeriodAsk &&
            !wantsAnalyzeSlip(trimmed) &&
            !altSign;
          const useTinyParlayPath = genericParlayPath && !usePropsOnlyParlayPath && buildLegs <= 3;
          const useCompactParlayPath =
            genericParlayPath && !usePropsOnlyParlayPath && buildLegs > 3 && buildLegs <= MAX_LEGS;
          const useMlbSlatePath =
            !genericParlayPath &&
            !useFocalSportParlayPath &&
            wantsMlbPitcherSlateAsk(trimmed) &&
            !wantsAnalyzeSlip(trimmed) &&
            !oddsThreshold &&
            !altSign;
          const usePropPickPath =
            !isParlayBuild &&
            !slipImageVerdictOnly &&
            wantsPropPickRecommendation(trimmed) &&
            !wantsAnalyzeSlip(trimmed) &&
            !oddsThreshold &&
            !confidenceThreshold &&
            !includePeriods &&
            !altSign;
          const streamWarmBuild =
            isParlayBuild ||
            useMlbSlatePath ||
            usePropPickPath ||
            genericParlayPath ||
            useFocalSportParlayPath ||
            usePropsOnlyParlayPath;
          const warmP =
            streamWarmBuild && !slipImageVerdictOnly
              ? warmApiForCoachBuild(controller.signal)
              : Promise.resolve();
          if (usePropsOnlyParlayPath) {
            // Props-only: wake cold autoscale BEFORE prop fan-out so /api/chat isn't
            // the first heavy hit after a 20s parallel props fetch.
            await warmP;
          }
          const boardScanPreEligible = reachBoardScanEligible({
            isAnalyze: wantsAnalyzeSlip(trimmed),
            requestedLegs,
            propsOnly: wantsPropsOnly(trimmed),
            explicitSingleGame,
            oddsThreshold,
            confidenceThreshold,
          });
          const reachFullPreScanEligible =
            boardScanPreEligible && legTarget >= INSTANT_SLATE_SEED_MIN_LEGS && !slipImageVerdictOnly;
          if (reachFullPreScanEligible || (boardScanPreEligible && legTarget >= INSTANT_SLATE_SEED_MIN_LEGS)) {
            setParlayBuildPhase("board-scan");
            setBoardScanAwaiting(true);
            boardScanInFlightRef.current = true;
          }
          if (
            isParlayBuild &&
            legTarget >= INSTANT_SLATE_SEED_MIN_LEGS &&
            boardScanPreEligible &&
            !slipImageVerdictOnly &&
            !reachFullPreScanEligible &&
            !earlyReachBoardScanRef.current
          ) {
            earlyReachBoardScanRef.current = kickoffEarlyReachBoardScan({
              target: Math.min(legTarget, MAX_LEGS),
              sportScopeText: trimmed,
              excludedSports,
              signal: controller.signal,
            });
            boardScanInFlightRef.current = true;
            setBoardScanAwaiting(true);
            if (useParlayKernel) kernelParlayActiveRef.current = true;
            watchBoardScanCompletion(earlyReachBoardScanRef.current, sendGen, { earlyScan: true });
          }
          type ScanFeeds = {
            espnGames: import("@/lib/api").EspnGame[];
            oddsGames: import("@/lib/api").OddsGame[];
            liveFeed: { games: unknown[]; odds: import("@/lib/api").RealOddsEntry[] };
          };
          let scanFeedsPromise: Promise<ScanFeeds> | null = null;
          if (reachFullPreScanEligible) {
            setParlayBuildPhase("board-scan");
            const scanSports = coachLiveScanSports(excludedSports);
            scanFeedsPromise = Promise.all([
              Promise.all(scanSports.map((s) => getGames(s).catch(() => []))).then((rows) =>
                rows.flat(),
              ),
              Promise.all(scanSports.map((s) => getOdds(s).catch(() => []))).then((rows) =>
                filterBettableOddsGames(rows.flat()),
              ),
              getLiveOdds(scanSports, abortRef.current?.signal).catch(() => ({
                games: [],
                odds: [],
              })),
            ]).then(([espnGames, oddsGames, liveFeed]) => ({ espnGames, oddsGames, liveFeed }));
          }
          const streamSlateSport = focalSports.size === 1 ? [...focalSports][0]! : null;
          const preAnalysisSeed =
            genericParlayPath &&
            !usePropsOnlyParlayPath &&
            !useFocalSportParlayPath &&
            !useTinyParlayPath &&
            !slipImageVerdictOnly &&
            legTarget >= INSTANT_SLATE_SEED_MIN_LEGS
              ? readSlatePreAnalysisSeed({ legs: legTarget, sport: streamSlateSport })
              : null;
          if (preAnalysisSeed?.boardScan?.picks?.length) {
            preBoardScan = markBoardScanAsPreview(preAnalysisSeed.boardScan);
            flashEnrichRef.current = coachFlashEnrichFromBuilt(preAnalysisSeed.built, {
              propSimulations: preAnalysisSeed.propSimulations,
              perfByFamily: marketPerf,
            });
            patchInstantBoardScanTicket(preBoardScan, flashEnrichRef.current, {
              legNote: COACH_SLATE_PREVIEW_NOTE,
              ticketLegTarget: legTarget,
            });
          }
          const earlyReachBoardScanPromise = earlyReachBoardScanRef.current;
          const rawBuilt = slipImageVerdictOnly
            ? {
                context: {
                  selectedSports: [],
                  currentSlip: slipForContext,
                  realGames: [],
                  realOdds: [],
                  realProps: [],
                } satisfies ChatContext,
                propPool: [] as PropPoolEntry[],
                gameMeta: [] as GameMeta[],
                todayOnly: false,
              }
            : useTinyParlayPath
            ? await buildTinyParlayContext(controller.signal, { excludeSports: excludeSportsList })
            : usePropsOnlyParlayPath
              ? await buildPropsOnlyParlayContext(buildLegs, controller.signal, {
                  excludeSports: excludeSportsList,
                })
            : useFocalSportParlayPath && focalSportId
              ? await buildFocalSportParlayContext(focalSportId, buildLegs, controller.signal, {
                  tonightOnly: slateDay === "tonight" || wantsTonightSlate(trimmed),
                  focalText: trimmed,
                })
            : useCompactParlayPath
              ? await buildCompactParlayContext(buildLegs, controller.signal, {
                  excludeSports: excludeSportsList,
                })
              : useMlbSlatePath
                ? await buildMlbSlateContext(controller.signal)
                : usePropPickPath
                  ? await buildPropPickContext(focalForPools, controller.signal)
                : await buildChatContext(
                buildSports,
                slipForContext,
                controller.signal,
                oddsThreshold,
                includePeriods,
                focalForPools,
                altSign,
                buildLegs,
                wantsAnalyzeSlip(trimmed),
              );
          const enriched =
            slipImageVerdictOnly || usePropPickPath
              ? { built: rawBuilt, propSimulations: new Map<string, { hitProbability: number | null }>() }
              : boardScanPreEligible
                ? { built: rawBuilt, propSimulations: new Map<string, { hitProbability: number | null }>() }
              : isParlayBuild &&
            !usePropsOnlyParlayPath &&
            rawBuilt.propPool.length > 0 &&
            rawBuilt.context.realProps?.length
              ? await enrichChatContextProps(rawBuilt, controller.signal, { requestedLegs: buildLegs })
              : !isParlayBuild &&
                  rawBuilt.propPool.length > 0 &&
                  rawBuilt.context.realProps?.length
                ? await enrichChatContextProps(rawBuilt, controller.signal)
                : { built: rawBuilt, propSimulations: new Map<string, { hitProbability: number | null }>() };
          ({ context, propPool, gameMeta, todayOnly } = enriched.built);
          propSimulations = enriched.propSimulations;
          if (excludedSports.size > 0) {
            context = {
              ...context,
              excludedSports: excludeSportsList,
              realOdds: filterForExcludedSports(context.realOdds, excludedSports),
              realProps: filterForExcludedSports(context.realProps ?? [], excludedSports),
              realGames: filterForExcludedSports(context.realGames ?? [], excludedSports),
            };
            propPool = filterForExcludedSports(propPool, excludedSports);
          }
          flashEnrichRef.current = coachFlashEnrichFromBuilt(
            { context, propPool, gameMeta },
            { propSimulations, perfByFamily: marketPerf },
          );
          rehydrateVisibleBoardTicket();
          const reachTargetPreScan = Math.min(legTarget, MAX_LEGS);
          const boardScanVariety = {
            varietySeed,
            varietyContext: varietyContextWithLastDelivered(recentParlayVarietyContext()),
            requestId: coachRequestContextRef.current?.requestId ?? varietySeed,
            ticketStyle: coachTicketStyle,
          };
          const reachFullPreScan = reachFullPreScanEligible;
          if (reachFullPreScan) {
            didReachFullPreScan = true;
            try {
              if (preBoardScan?.picks?.length) {
                flashBoardScanResult(markBoardScanAsPreview(preBoardScan), {
                  ...flashEnrichRef.current,
                  realOdds: [
                    ...flashEnrichRef.current.realOdds,
                    ...[...preBoardScan.evalLinesByGame.values()].flat(),
                  ],
                });
              }
              if (earlyReachBoardScanPromise) {
                const earlyScan = await earlyReachBoardScanPromise;
                if (earlyScan?.picks?.length) {
                  flashBoardScanResult(markBoardScanAsPreview(earlyScan), {
                    ...flashEnrichRef.current,
                    realOdds: [
                      ...flashEnrichRef.current.realOdds,
                      ...[...(earlyScan.evalLinesByGame?.values() ?? [])].flat(),
                    ],
                  });
                }
              }
              const { espnGames, oddsGames, liveFeed } = scanFeedsPromise
                ? await scanFeedsPromise
                : await (async () => {
                    const scanSports = coachLiveScanSports(excludedSports);
                    const [eg, og, lf] = await Promise.all([
                      Promise.all(scanSports.map((s) => getGames(s).catch(() => []))).then((rows) =>
                        rows.flat(),
                      ),
                      Promise.all(scanSports.map((s) => getOdds(s).catch(() => []))).then((rows) =>
                        filterBettableOddsGames(rows.flat()),
                      ),
                      getLiveOdds(scanSports, abortRef.current?.signal).catch(() => ({
                        games: [],
                        odds: [],
                      })),
                    ]);
                    return { espnGames: eg, oddsGames: og, liveFeed: lf };
                  })();
              const scanTeamIdMap = buildGameTeamIdMap(espnGames);
              preBoardScan = await tryReachFullBoardScan({
                target: reachTargetPreScan,
                oddsGames,
                propPool,
                realOdds: context.realOdds,
                liveOdds: liveFeed.odds,
                espnGames,
                gameMeta,
                teamIdMap: scanTeamIdMap,
                excludedSports,
                matchupHistory: context.matchupHistory,
                matchupInjuries: context.matchupInjuries,
                playerHistory: context.playerHistory as Record<string, PlayerHistorySlice> | undefined,
            mlbPlatoon: context.mlbPlatoon,
            mlbGameEnv: context.mlbGameEnv,
                perfByFamily: marketPerf,
                calibration: modelCalibration,
                onPartial: onBoardScanPartial,
                signal: abortRef.current?.signal,
                scanTimeoutMs: boardScanBudgetMs(reachTargetPreScan),
                ...boardScanVariety,
              });
              if (preBoardScan) {
                latestBoardScanRef.current = preBoardScan;
                setBoardScanLiveProgress(deriveBoardScanLiveProgress(preBoardScan));
                if (preBoardScan.picks.length) {
                  setBoardScanPartialLegs(preBoardScan.picks.length);
                }
                if (
                  boardScanIsComplete(preBoardScan) &&
                  preBoardScan.picks.length &&
                  !boardTicketSnapshotRef.current?.length
                ) {
                  patchInstantBoardScanTicket(preBoardScan, flashEnrichRef.current, {
                    ticketLegTarget: reachTargetPreScan,
                  });
                }
              }
              freshBoardScanComplete = !!(
                preBoardScan?.picks?.length &&
                boardScanIsComplete(preBoardScan) &&
                boardScanReadyForDelivery(preBoardScan, reachTargetPreScan)
              );
              const scanForDelivery = preferFinalBoardScanForDelivery(
                reachTargetPreScan,
                preBoardScan,
                latestBoardScanRef.current,
              );
              if (scanForDelivery) {
                preBoardScan = scanForDelivery;
                const scanEnrich = {
                  ...flashEnrichRef.current,
                  realOdds: [
                    ...flashEnrichRef.current.realOdds,
                    ...[...scanForDelivery.evalLinesByGame.values()].flat(),
                  ],
                };
                if (boardScanIsComplete(scanForDelivery)) {
                  deliverBoardScanTicket(scanForDelivery, scanEnrich);
                  if (
                    !boardTicketSnapshotRef.current?.length &&
                    scanForDelivery.picks?.length
                  ) {
                    patchInstantBoardScanTicket(scanForDelivery, scanEnrich, {
                      ticketLegTarget: reachTargetPreScan,
                    });
                  }
                } else if (scanForDelivery.picks?.length) {
                  patchInstantBoardScanTicket(scanForDelivery, scanEnrich, {
                    ticketLegTarget: reachTargetPreScan,
                  });
                }
              }
            } catch {
              preBoardScan = preferFinalBoardScanForDelivery(
                reachTargetPreScan,
                latestBoardScanRef.current,
                preBoardScan,
              );
            }
          }
          const kernelScanReady = !!(
            boardScanIsComplete(preBoardScan) ||
            boardScanIsComplete(latestBoardScanRef.current) ||
            preBoardScan?.picks?.length ||
            latestBoardScanRef.current?.picks?.length
          );
          const skipModelStreamForBoardScan = useParlayKernel
            ? freshBoardScanComplete && kernelScanReady
            : freshBoardScanComplete && reachFullPreScan;
          // "Today / tonight" ask: buildChatContext already restricts the pools to
          // today's upcoming games AND returns the EFFECTIVE decision it applied.
          // We reuse that `todayOnly` (NOT a fresh wantsTodayOnly) so the post-parse
          // pick filter below stays consistent with the context build.
          if (modelStrengths.length > 0) context.modelStrengths = modelStrengths;
          const apiMessages: ChatMessage[] = history.map((m) => ({
            role: m.role,
            content: m.apiContent ?? m.content,
          }));

          // Background-finish: a signed-in parlay build is eligible to keep going
          // server-side if the app is backgrounded. We save the LOCAL context
          // (keyed by buildId) FIRST so a kill/relaunch can still rebuild the
          // cards, then pass the same buildId + opt-in flag to the server. A
          // non-parlay chat or signed-out user just streams normally.
          const bg = skipModelStreamForBoardScan
            ? false
            : shouldHandOffBuild({ isParlayBuild, isSignedIn: !!isSignedIn });
          const buildId = bg ? makeBuildId() : "";
          if (bg) {
            pendingBgRef.current = { buildId };
            handedOffRef.current = false;
            // Persist before streaming so a quick background/kill can still resume
            // from disk (a fire-and-forget write often lost the race).
            await savePendingBuild({
              buildId,
              userText: trimmed,
              context,
              propPool,
              gameMeta,
              todayOnly,
              createdAt: Date.now(),
            });
          }

          let first = true;
          let uploadContext: ChatContext = context;
          if (slipImageVerdictOnly) {
            uploadContext = context;
          } else if (usePropsOnlyParlayPath) {
            uploadContext = propsOnlySlimChatContextForUpload(context);
          } else if (isParlayBuild && buildLegs <= 3) {
            uploadContext = microSlimChatContextForUpload(context);
          } else if (isParlayBuild && buildLegs <= 8) {
            uploadContext = compactSlimChatContextForUpload(context);
          } else if (isParlayBuild && buildLegs <= MAX_LEGS) {
            uploadContext = largeCompactSlimChatContextForUpload(context);
          } else if (useMlbSlatePath) {
            uploadContext = compactSlimChatContextForUpload(context);
          } else if (usePropPickPath && wantsSoccerScorerGoalkeeperPicks(trimmed)) {
            uploadContext = soccerScorerGkSlimChatContextForUpload(context);
          } else if (usePropPickPath) {
            uploadContext = microSlimChatContextForUpload(context);
          } else {
            // Belt-and-braces: every Coach stream slims the upload so a 100KB+
            // context never connect-stalls when /chat/context-stash is unavailable.
            uploadContext = slimChatContextForUpload(context);
          }
          const parlayFirstTokenMs =
            buildLegs >= 12 ? 120_000 : buildLegs >= 9 ? 90_000 : buildLegs >= 6 ? 75_000 : undefined;
          const visionFirstTokenMs = hasOutgoingImages ? 90_000 : undefined;
          const propPickFirstTokenMs = usePropPickPath ? 75_000 : undefined;
          const runStream = async (streamContext: ChatContext = uploadContext) => {
            first = true;
            if (!usePropsOnlyParlayPath && !slipImageVerdictOnly) await warmP;
            else if (slipImageVerdictOnly) await warmApiForCoachBuild(controller.signal);
            return streamChat({
              messages: apiMessages,
              context: streamContext,
              imageDataUrls: outgoingImageDataUrls,
              signal: controller.signal,
              notifyOnBackground: bg,
              buildId,
              firstTokenMs: isParlayBuild ? parlayFirstTokenMs : propPickFirstTokenMs ?? visionFirstTokenMs,
              onProps: (rows: RealPropEntry[]) => {
                serverPropPool.push(...propPoolFromRealProps(rows));
              },
              onToken: (sofar) => {
                if (first) {
                  first = false;
                  setWaiting(false);
                }
                setMessages((prev) => {
                  const copy = [...prev];
                  copy[copy.length - 1] = { ...copy[copy.length - 1], role: "assistant", content: sofar };
                  return copy;
                });
                scrollToEnd(false);
              },
            });
          };

          try {
            if (skipModelStreamForBoardScan || useParlayKernel) {
              full = "";
              if (useParlayKernel) {
                kernelParlayActiveRef.current = true;
                setBoardScanAwaiting(true);
                setParlayBuildPhase("board-scan");
              }
              const kernelLegTarget = Math.min(reachTargetPreScan || legTarget, MAX_LEGS);
              const scanForDelivery = await resolveScanForKernelDelivery(
                kernelLegTarget,
                {
                  preBoardScan,
                  latest: latestBoardScanRef.current,
                  earlyInflight: earlyReachBoardScanRef.current,
                },
                controller.signal,
              );
              const scanEnrich = {
                ...flashEnrichRef.current,
                realOdds: scanForDelivery
                  ? [
                      ...flashEnrichRef.current.realOdds,
                      ...[...scanForDelivery.evalLinesByGame.values()].flat(),
                    ]
                  : flashEnrichRef.current.realOdds,
              };
              if (useParlayKernel) {
                logCoachPickDiag("delivery-attempt", {
                  stage: "kernel-primary",
                  kernelLegTarget,
                  scanComplete: scanForDelivery?.scanComplete ?? false,
                  pickCount: scanForDelivery?.picks.length ?? 0,
                });
                if (
                  deliverKernelBoardScan(scanForDelivery, scanEnrich, kernelLegTarget)
                ) {
                  kernelParlayDelivered = true;
                  setBoardScanAwaiting(false);
                  setBoardScanLiveProgress(null);
                  kernelParlayActiveRef.current = false;
                } else if (scanForDelivery?.picks?.length) {
                  if (
                    patchInstantBoardScanTicket(scanForDelivery, scanEnrich, {
                      ticketLegTarget: kernelLegTarget,
                    })
                  ) {
                    kernelParlayDelivered = true;
                    setBoardScanAwaiting(false);
                    setBoardScanLiveProgress(null);
                    kernelParlayActiveRef.current = false;
                  }
                } else if (boardScanIsComplete(scanForDelivery)) {
                  tryInstantSlateSeedDelivery(legTarget);
                }
              } else if (scanForDelivery) {
                deliverBoardScanTicket(scanForDelivery, scanEnrich);
              } else if (!useParlayKernel) {
                tryInstantSlateSeedDelivery(legTarget);
              }
            } else if (useParlayKernel) {
              full = "";
              setParlayBuildPhase("board-scan");
              setBoardScanAwaiting(true);
              kernelParlayActiveRef.current = true;
              const kernelLegTarget = Math.min(reachTargetPreScan || legTarget, MAX_LEGS);
              const scanForDelivery = await resolveScanForKernelDelivery(
                kernelLegTarget,
                {
                  preBoardScan,
                  latest: latestBoardScanRef.current,
                  earlyInflight: earlyReachBoardScanRef.current,
                },
                controller.signal,
              );
              logCoachPickDiag("delivery-attempt", {
                stage: "kernel-fallback",
                kernelLegTarget,
                scanComplete: scanForDelivery?.scanComplete ?? false,
                pickCount: scanForDelivery?.picks.length ?? 0,
              });
              if (!scanForDelivery) {
                if (!boardScanAwaiting) tryInstantSlateSeedDelivery(legTarget);
              } else {
                const scanEnrich = {
                  ...flashEnrichRef.current,
                  realOdds: [
                    ...flashEnrichRef.current.realOdds,
                    ...[...scanForDelivery.evalLinesByGame.values()].flat(),
                  ],
                };
                if (
                  deliverKernelBoardScan(scanForDelivery, scanEnrich, kernelLegTarget)
                ) {
                  kernelParlayDelivered = true;
                  setBoardScanAwaiting(false);
                  setBoardScanLiveProgress(null);
                  kernelParlayActiveRef.current = false;
                } else if (scanForDelivery.picks?.length) {
                  if (
                    patchInstantBoardScanTicket(scanForDelivery, scanEnrich, {
                      ticketLegTarget: kernelLegTarget,
                    })
                  ) {
                    kernelParlayDelivered = true;
                    setBoardScanAwaiting(false);
                    setBoardScanLiveProgress(null);
                    kernelParlayActiveRef.current = false;
                  }
                } else if (boardScanIsComplete(scanForDelivery)) {
                  tryInstantSlateSeedDelivery(legTarget);
                }
              }
            } else {
              setParlayBuildPhase("stream");
              full = await runStream();
            }
            if (!wantsAnalyzeSlip(trimmed)) {
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last?.role === "assistant") {
                  const { legNote: _ln, ...rest } = last;
                  copy[copy.length - 1] = { ...rest, content: "" };
                }
                return copy;
              });
            }
          } catch (streamErr: any) {
            if (useParlayKernel) throw streamErr;
            const retryable =
              (isParlayBuild || useMlbSlatePath || usePropPickPath) &&
              streamErr?.name !== "AbortError" &&
              !handedOffRef.current;
            if (!retryable) throw streamErr;
            serverPropPool.length = 0;
            setMessages((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = {
                role: "assistant",
                content: "Connection hiccup — trying your build once more…",
              };
              return copy;
            });
            setWaiting(true);
            scrollToEnd();
            if (isParlayBuild) {
              uploadContext = usePropsOnlyParlayPath
                ? propsOnlySlimChatContextForUpload(context)
                : buildLegs <= 3
                  ? microSlimChatContextForUpload(context)
                  : buildLegs <= 8
                    ? compactSlimChatContextForUpload(context)
                    : ultraSlimChatContextForUpload(context);
            } else if (usePropPickPath && wantsSoccerScorerGoalkeeperPicks(trimmed)) {
              uploadContext = soccerScorerGkSlimChatContextForUpload(context);
            } else if (usePropPickPath) {
              uploadContext = microSlimChatContextForUpload(context);
            }
            full = await runStream(uploadContext);
            if (!wantsAnalyzeSlip(trimmed)) {
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last?.role === "assistant") {
                  const { legNote: _ln, ...rest } = last;
                  copy[copy.length - 1] = { ...rest, content: "" };
                }
                return copy;
              });
            }
          }
          // Streamed to completion in-app — no background hand-off happened, so
          // drop the pending record and its eligibility flag.
          if (bg) {
            pendingBgRef.current = null;
            await clearPendingBuild();
          }
        }
        if (useParlayKernel) {
          const kernelLegTarget = Math.min(
            requestedLegCount(trimmed) || effectiveBuildLegCount(trimmed) || legTarget,
            MAX_LEGS,
          );
          if (
            !kernelParlayDelivered &&
            !boardTicketSnapshotRef.current?.length
          ) {
            const scan = preferFinalBoardScanForDelivery(
              kernelLegTarget,
              latestBoardScanRef.current,
              preBoardScan,
            );
            if (scan && boardScanIsComplete(scan)) {
              kernelParlayDelivered = deliverKernelBoardScan(
                scan,
                flashEnrichRef.current,
                kernelLegTarget,
              );
            }
          }
          const finalScan = preferFinalBoardScanForDelivery(
            kernelLegTarget,
            latestBoardScanRef.current,
            preBoardScan,
          );
          const snapshotMatchesTarget =
            !boardTicketSnapshotRef.current?.length ||
            (finalScan != null && boardScanReadyForDelivery(finalScan, kernelLegTarget));
          if (
            (freshBoardScanComplete || kernelParlayDelivered) &&
            boardTicketSnapshotRef.current?.length &&
            snapshotMatchesTarget &&
            boardScanReadyForDelivery(finalScan, kernelLegTarget)
          ) {
            if (buildProgressTimerRef.current) {
              clearTimeout(buildProgressTimerRef.current);
              buildProgressTimerRef.current = null;
            }
            clearBuildStallWatchdog();
            releaseOtaBlock();
            setCoachBuildBusy(false);
            setWaiting(false);
            setStreaming(false);
            setBuildFinishing(false);
            setBuildProgressExpired(false);
            setParlayBuildPhase("idle");
            setBoardScanPartialLegs(0);
            setBoardScanAwaiting(false);
            setBoardScanLiveProgress(null);
            kernelParlayActiveRef.current = false;
            abortRef.current = null;
            scrollToEnd();
            return;
          }
          if (
            useParlayKernel &&
            !kernelParlayDelivered &&
            finalScan &&
            !boardScanIsComplete(finalScan)
          ) {
            setBuildFinishing(true);
            setBoardScanAwaiting(true);
            setParlayBuildPhase("board-scan");
            releaseOtaBlock();
            setCoachBuildBusy(false);
            abortRef.current = null;
            scrollToEnd();
            return;
          }
          if (useParlayKernel && boardScanIsComplete(finalScan)) {
            if (
              !kernelParlayDelivered &&
              !boardTicketSnapshotRef.current?.length &&
              !deliverPendingBoardScanIfReady()
            ) {
              setBuildFinishing(true);
              setBoardScanAwaiting(true);
              setParlayBuildPhase("board-scan");
              if (finalScan) {
                setBoardScanLiveProgress(deriveBoardScanLiveProgress(finalScan));
                setBoardScanPartialLegs(finalScan.picks.length);
              }
            } else if (boardTicketSnapshotRef.current?.length) {
              setBoardScanAwaiting(false);
              setBoardScanLiveProgress(null);
              kernelParlayActiveRef.current = false;
            }
          }
        }
        // Merge server rows the client pool is missing (the client pool wins on
        // collision so its render metadata — headshot/teamAbbr — is preserved).
        const mergedPropPool: PropPoolEntry[] = (() => {
          const base =
            excludedSports.size > 0 ? filterForExcludedSports(propPool, excludedSports) : propPool;
          if (serverPropPool.length === 0) return base;
          const key = (e: PropPoolEntry) =>
            `${e.game}|${e.player}|${e.line}|${e.side}|${e.marketLabel}`.toLowerCase();
          const seen = new Set(base.map(key));
          const extra = serverPropPool.filter((e) => !seen.has(key(e)));
          const merged = extra.length ? [...base, ...extra] : base;
          return excludedSports.size > 0 ? filterForExcludedSports(merged, excludedSports) : merged;
        })();
        let pickEnrich = coachFlashEnrichFromBuilt(
          { context, propPool: mergedPropPool, gameMeta },
          { propSimulations, perfByFamily: marketPerf },
        );
        flashEnrichRef.current = pickEnrich;
        rehydrateVisibleBoardTicket();
        selectionOpts = {
          propPool: mergedPropPool,
          matchupHistory: context.matchupHistory,
          matchupInjuries: context.matchupInjuries,
          playerHistory: context.playerHistory as Record<string, PlayerHistorySlice> | undefined,
          propSimulations,
          varietySeed,
        };
        let reachBoardScan: FullBoardScanResult | null = null;
        const reachBoardEligible = reachBoardScanEligible({
          isAnalyze: wantsAnalyzeSlip(trimmed),
          requestedLegs,
          propsOnly: wantsPropsOnly(trimmed),
          explicitSingleGame,
          oddsThreshold,
          confidenceThreshold,
        });
        if (reachBoardEligible) {
          const cachedBoardScan = preferFinalBoardScanForDelivery(
            Math.min(legTarget, MAX_LEGS),
            preBoardScan,
            latestBoardScanRef.current,
          );
          if (cachedBoardScan && !didReachFullPreScan) {
            reachBoardScan = cachedBoardScan;
          } else if (didReachFullPreScan && boardScanIsComplete(preBoardScan ?? undefined)) {
            reachBoardScan =
              preferFinalBoardScanForDelivery(
                Math.min(legTarget, MAX_LEGS),
                preBoardScan,
                latestBoardScanRef.current,
              ) ?? preBoardScan;
          } else if (!didReachFullPreScan || !freshBoardScanComplete) {
            const scanSports = coachLiveScanSports(excludedSports);
            const [espnGames, oddsGames, liveFeed] = await Promise.all([
              Promise.all(scanSports.map((s) => getGames(s).catch(() => []))).then((rows) =>
                rows.flat(),
              ),
              Promise.all(scanSports.map((s) => getOdds(s).catch(() => []))).then((rows) =>
                filterBettableOddsGames(rows.flat()),
              ),
              getLiveOdds(scanSports, abortRef.current?.signal).catch(() => ({
                games: [],
                odds: [],
              })),
            ]);
            const reachBoardScanMs = boardScanBudgetMs(Math.min(legTarget, MAX_LEGS));
            reachBoardScan = await tryReachFullBoardScan({
              target: Math.min(legTarget, MAX_LEGS),
              oddsGames,
              propPool: mergedPropPool,
              realOdds: context.realOdds,
              liveOdds: liveFeed.odds,
              espnGames,
              gameMeta,
              teamIdMap: buildGameTeamIdMap(espnGames),
              excludedSports,
              matchupHistory: context.matchupHistory,
              matchupInjuries: context.matchupInjuries,
              playerHistory: context.playerHistory as Record<string, PlayerHistorySlice> | undefined,
              mlbPlatoon: context.mlbPlatoon,
              mlbGameEnv: context.mlbGameEnv,
              perfByFamily: marketPerf,
              calibration: modelCalibration,
              onPartial: onBoardScanPartial,
              varietySeed,
              varietyContext: varietyContextWithLastDelivered(recentParlayVarietyContext()),
              ticketStyle: coachTicketStyle,
              requestId: coachRequestContextRef.current?.requestId ?? varietySeed,
              signal: abortRef.current?.signal,
              scanTimeoutMs: reachBoardScanMs,
            });
            if (!reachBoardScan) {
              const requestId = coachRequestContextRef.current?.requestId;
              reachBoardScan = readBoardScanFinal(
                boardScanFinalByRequestRef.current,
                requestId,
                latestBoardScanRef.current,
              );
            } else if (
              !reachBoardScan?.picks?.length &&
              latestBoardScanRef.current?.picks?.length
            ) {
              const ref = latestBoardScanRef.current;
              if (ref && boardScanReadyForDelivery(ref, Math.min(legTarget, MAX_LEGS))) {
                reachBoardScan = ref;
              }
            }
          }
        }
        let fullBoardScanned =
          boardScanIsComplete(reachBoardScan) ||
          boardScanIsComplete(preBoardScan) ||
          boardScanIsComplete(latestBoardScanRef.current);
        let fullBoardScanMeta: FullBoardScanResult | null = preferFinalBoardScanForDelivery(
          Math.min(legTarget, MAX_LEGS),
          reachBoardScan,
          preBoardScan,
          latestBoardScanRef.current,
        );
        if (fullBoardScanMeta?.picks?.length) {
          const scanOdds = fullBoardScanMeta.evalLinesByGame
            ? [...fullBoardScanMeta.evalLinesByGame.values()].flat()
            : [];
          flashBoardScanResult(fullBoardScanMeta, {
            ...flashEnrichRef.current,
            propPool: mergedPropPool,
            realOdds: [...flashEnrichRef.current.realOdds, ...scanOdds],
          });
        }
        if (isParlayBuild && !wantsAnalyzeSlip(trimmed)) {
          setParlayBuildPhase("score");
        }
        let boardBuilt = fullBoardScanned;
        let diversityNote = fullBoardScanMeta?.note ?? "";

        // Explicit "alt picks" ask: mobile sends no per-player game-log data, so
        // the model can't reason about which alt rung to take. Snap resolved props
        // to the rung the user wants. DEFAULT for a bare alt is "cushion" — safe
        // deep-juice rungs in the -200..-500 band (what the user asked for). An
        // explicit value/plus-money/longshot ask flips to "value" (plus-money
        // upside). Odds-bound asks ("-300 or less") keep their own filter.
        // (altMentioned is computed above alongside the +/- sign detection.)
        const wantsValueRungs =
          /\b(?:value|plus[\s-]?money|long\s?shots?|longshots?|underdogs?|upside)\b/i.test(trimmed);
        // Map the explicit "+ alt" / "- alt" sign onto the prop rung swap so props
        // honor the same sign as the game-level alts: "+ alt" -> plus-money "value"
        // rungs, "- alt" -> minus-money "cushion" rungs. With no sign, a bare alt
        // keeps the cushion default (value only when value/upside words are used).
        const altRungBias: AltRungBias =
          altMentioned && !oddsThreshold
            ? altSign === "plus" || (altSign == null && wantsValueRungs)
              ? "value"
              : "cushion"
            : null;
        // "Analyze my ticket" is a READ-ONLY critique — the server emits prose only
        // and never PICK lines. We skip pick parsing entirely (no add-cards, no
        // backfill, no threshold/sign notes) and treat the reply as pure analysis
        // prose. Forcing emittedPickLines to 0 also stops the "couldn't ground any
        // of those legs" empty-bubble note from ever replacing the analysis if the
        // model were to slip a stray PICK line through.
        const isAnalyze = wantsAnalyzeSlip(trimmed);
        let picks =
          isAnalyze
            ? []
            : fullBoardScanMeta?.picks?.length
              ? [...fullBoardScanMeta.picks]
              : reachBoardEligible
                ? []
                : parsePicks(full, context.realOdds, mergedPropPool, gameMeta, altRungBias);
        if (!isAnalyze && fullBoardScanMeta?.picks?.length) {
          const scanOdds = fullBoardScanMeta.evalLinesByGame
            ? [...fullBoardScanMeta.evalLinesByGame.values()].flat()
            : [];
          const scanEnrich = {
            ...flashEnrichRef.current,
            propPool: mergedPropPool,
            realOdds: [...flashEnrichRef.current.realOdds, ...scanOdds],
          };
          latestBoardScanRef.current = fullBoardScanMeta;
          const boardTicket = boardScanPartialToTicket(fullBoardScanMeta, scanEnrich);
          if (boardTicket.length > 0) {
            picks = boardTicket;
          } else {
            flashBoardScanResult(fullBoardScanMeta, scanEnrich);
          }
        }
        picks = scrubExcludedSportsFromPicks(
          picks,
          excludedSports,
          mergedPropPool,
          context.realOdds,
          gameMeta,
        );
        if (!fullBoardScanMeta?.picks?.length) {
          picks = filterBettablePicks(
            enrichPicksWithStartsAt(picks, flashEnrichRef.current),
          );
        } else if (picks.length === 0) {
          const scanOdds = fullBoardScanMeta.evalLinesByGame
            ? [...fullBoardScanMeta.evalLinesByGame.values()].flat()
            : [];
          picks = finalizeCoachTicketPicks(
            tagTicketRoles([...fullBoardScanMeta.picks]),
            {
              ...flashEnrichRef.current,
              propPool: mergedPropPool,
              realOdds: [...flashEnrichRef.current.realOdds, ...scanOdds],
            },
          ).picks;
        }
        picks = preferBettableQualifiedPicks(
          enrichPicksWithStartsAt(picks, flashEnrichRef.current),
        );
        if (!isAnalyze && picks.length > 0 && !fullBoardScanMeta?.picks?.length && !reachBoardEligible) {
          const minEarlyFlash = requestedLegs >= 6 ? 3 : 2;
          if (picks.length >= minEarlyFlash) {
            flashCoachTicketPicks(picks);
          }
        }
        let soccerScorerGkSalvage = false;
        if (!isAnalyze && soccerScorerGkAsk && picks.length === 0) {
          const salvaged = buildSoccerScorerGkPicks(mergedPropPool, context.realOdds, gameMeta);
          if (salvaged.length > 0) {
            picks = salvaged;
            soccerScorerGkSalvage = true;
          }
        }
        // Belt-and-braces: when matchupHistory.mlLean names a winner, never render
        // an opposing ML/spread card — swap to the real posted line on the lean
        // side or drop. Variety rotates games/props/markets, not WHO wins.
        let mlLeanNote = "";
        if (!isAnalyze && picks.length > 0 && context.matchupHistory) {
          const realOddsForLean = slateDay
            ? filterOddsForSlateDay(context.realOdds, slateDay)
            : context.realOdds;
          const enforced = enforceMlLeanOnPicks(picks, {
            matchupHistory: context.matchupHistory,
            realOdds: realOddsForLean,
            gameMeta,
          });
          picks = enforced.picks;
          mlLeanNote = mlLeanEnforcementNote(enforced);
        }
        // Props-only ask: drop any game-level legs the model slipped in (ML/spread/
        // total). The reach-count backfill below will fill from realProps instead.
        const mentionsProps = mentionsPropIntent(trimmed);
        const propsOnlyTicket = wantsPropsOnly(trimmed);
        const deepMultiLegParlay = legTarget >= 6 && !explicitSingleGame;
        const longshotAsk = /\b(?:long\s?shots?|longshots?|lottery)\b/i.test(trimmed);
        const reachFull =
          requestedLegs >= 6 && deepMultiLegParlay && !propsOnlyTicket && !explicitSingleGame;
        // Fixed-leg policy: mains first, then qualifying alts — never round-out filler.
        const promoteQualifyingAlts = shouldPromoteQualifyingAltsForFixedLegTicket({
          requestedLegs,
          isParlayBuild,
          isAnalyze,
          propsOnly: propsOnlyTicket,
          explicitSingleGame,
          oddsThreshold,
          confidenceThreshold,
          altSign,
        });
        const boardScanReachFill = promoteQualifyingAlts && fullBoardScanned;
        const reachFillEligible = reachFull || boardScanReachFill;
        const blockUngradedTopUp = shouldBlockUngradedParlayTopUp({
          promoteQualifyingAlts,
          fullBoardScanned,
          reachBoardEligible,
        });
        const parlayRejections: ParlayLegReject[] = [];
        const composeFromBoard =
          !isAnalyze &&
          shouldComposeDeepParlayFromBoard(legTarget, {
            explicitSingleGame,
            propsOnly: propsOnlyTicket,
          });
        if (!fullBoardScanned && composeFromBoard) {
          picks = picks.filter((p) => p.isProp);
        }
        if (!fullBoardScanned && !isAnalyze && deepMultiLegParlay && !propsOnlyTicket) {
          picks = dedupeSameTeamGameLegs(picks).picks;
          const seeded = prepareDeepParlaySeed(picks, legTarget, { longshotAsk });
          picks = seeded.picks;
          if (seeded.stripped > 0) {
            boardBuilt = true;
            diversityNote = `_Cleared ${seeded.stripped} chalk game line${seeded.stripped === 1 ? "" : "s"} from the model scaffold — deep parlays are rebuilt from player props and alt rungs on the real board._`;
          }
        }
        const lockedPropMarket =
          mentionsProps &&
          /\b(strikeouts?|k'?s|home runs?|hrs?|hits?|total bases?|rebounds?|reb|assists?|ast|points?|pts|anytime td|touchdowns?|receptions?|pass yds?|rush yds?|rec yds?|goals?|shots on goal)\b/i.test(
            trimmed,
          );
        const avoidLegKeys = isParlayBuild ? recentParlayLegKeys() : undefined;
        const propBackfillOpts = {
          plusMoneyBias:
            wantsValueRungs ||
            /\b(?:long\s?shots?|longshots?|lottery)\b/i.test(trimmed),
          diversify: !lockedPropMarket,
          maxPerMarket: lockedPropMarket ? 99 : undefined,
          varietySeed,
          avoidLegKeys,
          selectionOpts,
        };
        let propsOnlyNote = "";
        if (!isAnalyze && propsOnlyTicket && picks.some((p) => !p.isProp)) {
          const droppedGame = picks.filter((p) => !p.isProp).length;
          picks = picks.filter((p) => p.isProp);
          propsOnlyNote = `_Dropped ${droppedGame} game-level leg${droppedGame === 1 ? "" : "s"} — this ticket is player props only._`;
        }
        // How many real PICK scaffold lines the model emitted (whether or not each
        // resolved to a real odds entry). Counted by the pipe-delimited shape
        // (PICK: + 4 fields) — same as parsePicks / the building-leg counter — so
        // prose that merely contains "PICK:" never trips the empty-bubble note.
        const emittedPickLines = isAnalyze
          ? 0
          : full
              .split("\n")
              .filter((l) => /^PICK\s*:.*\|.*\|.*\|/i.test(l.trim())).length;
        // Odds-threshold lock ("10 leg with -300 or less"): drop any leg whose
        // real price breaks the bound so the WHOLE ticket qualifies. The server
        // prompt already steers the model toward qualifying legs; this is the
        // belt-and-braces guarantee on the resolved real odds.
        let thresholdNote = "";
        if (oddsThreshold) {
          const before = picks.length;
          picks = picks.filter((p) => oddsSatisfiesThreshold(p.odds, oddsThreshold));
          const dropped = before - picks.length;
          // When the bound prunes legs (often to zero — "-300 or shorter" heavy
          // favorites are rare on a real board), the model's prose can still
          // read like a full ticket. Say plainly what actually survived so the
          // user is never left with confident text and zero cards. Also fire
          // when the model emitted PICK lines that NONE resolved to a real odds
          // entry (dropped stays 0 but there are still zero cards to show).
          if (dropped > 0 || (picks.length === 0 && emittedPickLines > 0)) {
            const bound =
              (oddsThreshold.signed > 0 ? `+${oddsThreshold.signed}` : `${oddsThreshold.signed}`) +
              (oddsThreshold.mode === "atLeast" ? " or longer" : " or shorter");
            thresholdNote =
              picks.length === 0
                ? `\n\n_No real legs on ${boardPhrase} were priced ${bound}, so there's nothing to show for that bound right now — try a looser number or a different market._`
                : `\n\n_Showing the ${picks.length} real leg${picks.length === 1 ? "" : "s"} priced ${bound}; dropped ${dropped} that didn't qualify._`;
          }
        }
        let confidenceNote = "";
        if (confidenceThreshold) {
          const before = picks.length;
          const scored = attachPickScores(picks, {
            realOdds: context.realOdds,
            propPool: mergedPropPool,
            matchupHistory: context.matchupHistory,
            matchupInjuries: context.matchupInjuries,
            perfByFamily: marketPerf,
            playerHistory: context.playerHistory as Record<string, PlayerHistorySlice> | undefined,
            mlbPlatoon: context.mlbPlatoon,
            mlbGameEnv: context.mlbGameEnv,
          });
          picks = scored.filter((p) =>
            confidenceSatisfiesThreshold(
              confidenceScoreFromSignals(p.scores?.scores),
              confidenceThreshold,
            ),
          );
          const dropped = before - picks.length;
          if (dropped > 0 || (picks.length === 0 && emittedPickLines > 0)) {
            const band = describeConfidenceThreshold(confidenceThreshold);
            confidenceNote =
              picks.length === 0
                ? `\n\n_None of ${slateLabel} grounded legs have enough strong signals behind them to reach ${band} confidence right now — that score is built from each leg's real matchup, form, line value, injury and price edges, and I won't invent a signal to fake the number. Try a lower confidence or a different market._`
                : `\n\n_Showing the ${picks.length} real leg${picks.length === 1 ? "" : "s"} with enough strong signals to reach ${band} confidence; dropped ${dropped} below that bar — I won't pad with lower-confidence legs._`;
          }
        }
        // Explicit "+ alt" / "- alt" sign lock: drop any resolved leg whose real
        // odds sign doesn't match what the user asked for, so EVERY card is on the
        // requested sign. The context already steers game-level alts (one rung per
        // side) and props (value/cushion swap) to the right sign; this is the
        // belt-and-braces guarantee on the resolved real odds — and it's the only
        // hard enforcement for props, where the swap is best-effort and can keep a
        // wrong-sign rung when the player's ladder has none on the asked sign. Only
        // drops real, resolved legs — never fabricates a substitute.
        let signNote = "";
        if (altSign) {
          const before = picks.length;
          picks = picks.filter((p) => (altSign === "plus" ? p.odds > 0 : p.odds < 0));
          const dropped = before - picks.length;
          if (dropped > 0 || (picks.length === 0 && emittedPickLines > 0)) {
            const word = altSign === "plus" ? "plus-money" : "minus-money";
            signNote =
              picks.length === 0
                ? `\n\n_No real ${word} alt legs were available on ${boardPhrase}, so there's nothing to show for a ${altSign === "plus" ? "+" : "-"} alt right now — try the other sign or a bare alt._`
                : `\n\n_Showing the ${picks.length} real ${word} alt leg${picks.length === 1 ? "" : "s"}; dropped ${dropped} that landed on the other sign._`;
          }
        }
        // "Today / tonight" ask: belt-and-braces drop of any resolved leg whose
        // game isn't on today's local calendar day or has already started. The
        // realOdds / realProps pools are already today-filtered, but the server's
        // fresh-fetch prop backfill can hand the model a tomorrow/started prop —
        // this guarantees none reaches the slip. Runs BEFORE the reach-the-count
        // backfill so any top-up draws only from today's remaining real games.
        let todayNote = "";
        let tonightNote = "";
        // Set when the today-only salvage below actually built a real ticket out
        // of nothing (the model refused / its legs were all filtered). The
        // model's streamed prose (`full`) is then a refusal or stripped scaffold
        // that contradicts the real cards we're about to show, so finalContent
        // gets a clean lead-in instead of that prose.
        let salvageBuilt = false;
        const beforeSlateFilter = picks.length;
        if (slateDay) {
          picks = filterPicksForSlateDay(picks, slateDay);
        }
        // SALVAGE — model emitted zero grounded legs (prose-only reply, every leg
        // filtered, or PICK lines that failed to resolve). Build the best honest
        // ticket from the real board — tonight/tomorrow when slateDay is set, else
        // the full pregame 48h pool. Fires even when the model emitted ZERO PICK
        // lines (a common failure mode: marketing prose with no PICK: scaffold).
        const salvageEligible =
          picks.length === 0 &&
          legTarget > 0 &&
          !oddsThreshold &&
          !confidenceThreshold &&
          !altSign;
        const salvageBuildOpts = {
          trimmed,
          slateDay,
          contextOdds: context.realOdds,
          mergedPropPool,
          gameMeta,
          propsOnlyTicket,
          propBackfillOpts,
          signal: controller.signal,
        };
        if (salvageEligible) {
          const tgt = Math.min(legTarget, MAX_LEGS);
          picks = await buildParlaySalvagePicks({ ...salvageBuildOpts, target: tgt });
          if (picks.length > 0) salvageBuilt = true;
        }
        if (slateDay && picks.length === 0) {
          todayNote = todayBuildNote({
            before: beforeSlateFilter,
            surviving: picks.length,
            emittedPickLines: emittedPickLines || (salvageEligible ? legTarget : 0),
          });
        }
        // REACH-THE-COUNT backstop. The model reliably ignores the prompt's
        // REACH-N rule and returns a leg or two short even when the real board has
        // plenty more — two flavors:
        //   (1) "+ alt"/"- alt": stops at one Alt Spread per game and never touches
        //       the alt-total ladder (sign-restricted backfill).
        //   (2) period / same-game (e.g. "15 leg ... 1 quarter ... half time ...
        //       alt spreads"): emits the period spreads/totals but skips the period
        //       MONEYLINES and the full-game ALT SPREAD the user explicitly asked
        //       for — both already in `realOdds` via includePeriods.
        // Deterministically fill toward the requested count from the SAME real
        // context — never fabricating (only appends real realOdds entries), gated
        // on an explicit count, a grounded ticket (picks.length > 0), and no active
        // odds-threshold lock (whose own filter must stay authoritative).
        const reachTarget = Math.min(legTarget, MAX_LEGS);
        const ticketTarget =
          requestedLegs > 0 ? requestedLegs : isParlayBuild ? reachTarget : 0;
        let reachPool = rotatePool(context.realOdds, `${trimmed}|${varietySeed}`);
        if (slateDay) reachPool = filterOddsForSlateDay(reachPool, slateDay);
        const forceBoardBuild =
          composeFromBoard && !oddsThreshold && !confidenceThreshold;
        const boardBuildOpts = {
          longshotAsk,
          plusMoneyBias: propBackfillOpts.plusMoneyBias,
          diversify: propBackfillOpts.diversify,
          varietySeed,
          avoidLegKeys,
          reachFull,
          selectionOpts,
        };
        const useFullBoardScan =
          !isAnalyze &&
          requestedLegs > 0 &&
          shouldUseFullBoardScan(legTarget, {
            propsOnly: propsOnlyTicket,
            explicitSingleGame,
            oddsThreshold,
            confidenceThreshold,
            requestedLegs,
            reachFull,
          });
        if (!fullBoardScanned && (preBoardScan || reachBoardScan)) {
          const boardScanResult = preferFinalBoardScanForDelivery(
            ticketTarget,
            reachBoardScan,
            preBoardScan,
          );
          if (
            boardScanResult &&
            boardScanReadyForDelivery(boardScanResult, ticketTarget)
          ) {
            const delivered = deliverCoachBoardScanTicket(
              boardScanResult,
              pickEnrich,
              ticketTarget,
            );
            if (delivered.picks.length) {
              picks = delivered.picks;
              fullBoardScanMeta = boardScanResult;
              fullBoardScanned = true;
              boardBuilt = true;
              liveScanDeliveredRef.current = true;
              diversityNote = boardScanResult.note;
            }
          }
        } else if (!fullBoardScanned && useFullBoardScan) {
          setParlayBuildPhase("board-scan");
          const scanSports = coachLiveScanSports(excludedSports);
          const [espnGames, oddsGames, liveFeed] = await Promise.all([
            Promise.all(scanSports.map((s) => getGames(s).catch(() => []))).then((rows) =>
              rows.flat(),
            ),
            Promise.all(scanSports.map((s) => getOdds(s).catch(() => []))).then((rows) =>
              filterBettableOddsGames(rows.flat()),
            ),
            getLiveOdds(scanSports, abortRef.current?.signal).catch(() => ({ games: [], odds: [] })),
          ]);
          const scanTeamIdMap = buildGameTeamIdMap(espnGames);
          const inlineScan = await tryReachFullBoardScan({
              target: reachTarget,
              oddsGames,
              propPool: mergedPropPool,
              realOdds: context.realOdds,
              liveOdds: liveFeed.odds,
              espnGames,
              gameMeta,
              teamIdMap: scanTeamIdMap,
              excludedSports,
              matchupHistory: context.matchupHistory,
              matchupInjuries: context.matchupInjuries,
              playerHistory: context.playerHistory as Record<string, PlayerHistorySlice> | undefined,
            mlbPlatoon: context.mlbPlatoon,
            mlbGameEnv: context.mlbGameEnv,
              perfByFamily: marketPerf,
              calibration: modelCalibration,
              signal: abortRef.current?.signal,
              onPartial: onBoardScanPartial,
              varietySeed,
              varietyContext: varietyContextWithLastDelivered(recentParlayVarietyContext()),
              ticketStyle: coachTicketStyle,
              requestId: coachRequestContextRef.current?.requestId ?? varietySeed,
              scanTimeoutMs: boardScanBudgetMs(reachTarget),
            });
          if (inlineScan) {
            fullBoardScanMeta = inlineScan;
            if (
              boardScanIsComplete(inlineScan) &&
              boardScanReadyForDelivery(inlineScan, ticketTarget)
            ) {
              const delivered = deliverCoachBoardScanTicket(
                inlineScan,
                pickEnrich,
                ticketTarget,
              );
              picks = delivered.picks;
              fullBoardScanned = delivered.picks.length > 0;
              liveScanDeliveredRef.current = delivered.picks.length > 0;
            } else if (inlineScan.picks.length) {
              picks = inlineScan.picks;
            }
            boardBuilt = picks.length > 0;
            diversityNote = inlineScan.note;
          }
        } else if (forceBoardBuild && !blockUngradedTopUp) {
          picks = assembleDeepParlayFromBoard(
            reachTarget,
            mergedPropPool,
            reachPool,
            gameMeta,
            boardBuildOpts,
          );
          if (picks.length > 0) {
            boardBuilt = true;
            diversityNote = longshotAsk
              ? `_Longshot parlays are built from player props and alt rungs on the live board — not chalk moneylines._`
              : `_Your ${reachTarget}-leg ticket is built from player props and alt rungs on the live board — not the model's chalk moneyline scaffold._`;
          }
        } else if (
          shouldAllowReachCountBackfill({
            fullBoardScanned,
            reachBoardEligible,
            legTarget,
            isParlayBuild,
          }) &&
          needsParlayBackfill(picks, legTarget, { longshotAsk, deepParlay: deepMultiLegParlay }) &&
          (picks.length > 0 ||
            mentionsProps ||
            (legTarget >= 3 && !explicitSingleGame)) &&
          !oddsThreshold &&
          !confidenceThreshold
        ) {
          const target = reachTarget;
          // SINGLE-GAME / SPORT LOCK for the backfill pool — shared by EVERY
          // backfill order below so no branch widens a locked ticket. Derived
          // from the model's OWN resolved legs (and any game/sport the user named
          // this message):
          //   * lockedGame fires only for a genuine single-game intent — EVERY
          //     resolved leg (props included) on ONE game AND either 2+ legs
          //     resolved there or the user named it. A lone leg never locks (a
          //     generic N-leg ask that happened to ground one prop must still
          //     fill across the whole board).
          //   * lockedSports fires for a named sport, else the sport shared by 2+
          //     resolved legs (a lone leg never locks).
          // For a multi-game ticket both are null, so backfillPool === realOdds
          // and behavior is unchanged. This is what keeps the single-game
          // period/alt fill (the includePeriods branch below) scoped to the one
          // game instead of pulling in other matchups.
          const onlyGameLabel =
            new Set(picks.map((p) => norm(p.game))).size === 1
              ? picks[0].game
              : null;
          const lockedGame =
            onlyGameLabel &&
            (explicitSingleGame || gameMatchesFocalText(onlyGameLabel, trimmed))
              ? norm(onlyGameLabel)
              : null;
          const namedSports = focalSportsFromText(trimmed);
          const legSports = new Set(
            picks.map((p) => p.sport).filter((s): s is string => !!s),
          );
          const lockedSports =
            namedSports.size > 0
              ? namedSports
              : picks.length >= 2 && legSports.size === 1
                ? legSports
                : null;
          let backfillPool = lockedGame
            ? context.realOdds.filter((e) => norm(e.game) === lockedGame)
            : reachPool;
          if (lockedSports)
            backfillPool = backfillPool.filter((e) => lockedSports.has(e.sport));
          if (excludedSports.size > 0) {
            backfillPool = filterForExcludedSports(backfillPool, excludedSports);
          }
          if (slateDay && backfillPool === reachPool) {
            backfillPool = filterOddsForSlateDay(backfillPool, slateDay);
          }
          if (altSign) {
            picks = backfillPicks(picks, backfillPool, gameMeta, {
              target,
              altSign,
              order: ALT_BACKFILL_ORDER,
            });
          } else {
            // High-leg asks must reach N across the FULL slate — props first (the
            // board has hundreds), then game mains, then period markets. Applies
            // to any 6+ leg ticket (not only "tonight") so a bare "9-leg parlay"
            // doesn't stall at a handful of moneylines. Skip when the user locked
            // the build to one game.
            const deepMultiLegFill =
              legTarget >= 6 && !explicitSingleGame;
            // Server rule: 3+ leg tickets should mix props when available. Generic
            // "N-leg parlay" asks don't mention props, so we still backfill from
            // realProps — otherwise reach-N only walks game ML/spread/total and
            // lands short with chalky favorites.
            const mixPropsInBackfill =
              mentionsProps ||
              (thinSlateDepth && !explicitSingleGame) ||
              deepMultiLegFill ||
              (legTarget >= 3 && !explicitSingleGame);
            if (mixPropsInBackfill) {
              if (deepMultiLegFill) {
                const minProps = Math.max(1, Math.ceil(target * (longshotAsk ? 0.65 : 0.5)));
                const maxGameLegs = Math.max(
                  1,
                  Math.min(longshotAsk ? 2 : 3, target - minProps),
                );
                const propsNow = picks.filter((p) => p.isProp).length;
                if (propsNow < minProps) {
                  picks = backfillProps(picks, mergedPropPool, backfillPool, gameMeta, {
                    target: picks.length + (minProps - propsNow),
                    ...propBackfillOpts,
                  });
                }
                const gameOrder = deepMultiLegFill
                  ? [/^Alt Spread$/, /^Alt Total$/, /^Team Total$/i, /^Spread$/, /^Total$/]
                  : longshotAsk
                    ? [...ALT_BACKFILL_ORDER, /^Team Total$/i, ...GENERIC_BACKFILL_ORDER]
                    : [...ALT_BACKFILL_ORDER, ...GENERIC_BACKFILL_ORDER];
                const gamesNow = picks.filter((p) => !p.isProp && isGameLinePick(p)).length;
                const gameCap = Math.min(
                  target,
                  picks.length + Math.max(0, maxGameLegs - gamesNow),
                );
                if (!propsOnlyTicket && picks.length < gameCap) {
                  picks = backfillPicks(picks, backfillPool, gameMeta, {
                    target: gameCap,
                    order: gameOrder,
                  });
                }
                if (picks.length < target) {
                  picks = backfillProps(picks, mergedPropPool, backfillPool, gameMeta, {
                    target,
                    ...propBackfillOpts,
                  });
                }
              } else {
                picks = backfillProps(picks, mergedPropPool, backfillPool, gameMeta, {
                  target,
                  ...propBackfillOpts,
                });
                if (!propsOnlyTicket && picks.length < target) {
                  const gameOrder = longshotAsk
                    ? [...ALT_BACKFILL_ORDER, /^Team Total$/i, ...GENERIC_BACKFILL_ORDER]
                    : GENERIC_BACKFILL_ORDER;
                  picks = backfillPicks(picks, backfillPool, gameMeta, {
                    target,
                    order: gameOrder,
                  });
                }
              }
            } else if (explicitSingleGame && includePeriods) {
              picks = backfillPicks(picks, backfillPool, gameMeta, {
                target,
                order: PERIOD_BACKFILL_ORDER,
              });
            } else {
              const allProps = picks.every((p) => p.isProp);
              if (!allProps) {
                const gameLegs = picks.filter((p) => !p.isProp);
                const fams = new Set(gameLegs.map((p) => marketFamily(p.market)));
                const FAMILY_ORDER: Record<string, RegExp[]> = {
                  moneyline: [/^Moneyline$/],
                  spread: [/^Spread$/],
                  total: [/^Total$/],
                };
                const lockedFam =
                  gameLegs.length >= 2 && fams.size === 1 ? [...fams][0] : null;
                const order =
                  lockedFam && FAMILY_ORDER[lockedFam]
                    ? FAMILY_ORDER[lockedFam]
                    : GENERIC_BACKFILL_ORDER;
                picks = backfillPicks(picks, backfillPool, gameMeta, { target, order });
              }
            }
            if (includePeriods && picks.length < target) {
              picks = backfillPicks(picks, backfillPool, gameMeta, {
                target,
                order: PERIOD_BACKFILL_ORDER,
              });
            }
          }
        }
        {
          const dedupedAfterBackfill = dedupeSameTeamGameLegs(picks);
          picks = dedupedAfterBackfill.picks;
          picks = scrubExcludedSportsFromPicks(
            picks,
            excludedSports,
            mergedPropPool,
            mergedGameOdds,
            gameMeta,
          );
          if (dedupedAfterBackfill.dropped > 0 && !diversityNote) {
            diversityNote = `_Dropped ${dedupedAfterBackfill.dropped} duplicate team leg${dedupedAfterBackfill.dropped === 1 ? "" : "s"} after backfill._`;
          }
          if (
            false &&
            deepMultiLegParlay &&
            picks.length < Math.min(legTarget, MAX_LEGS) &&
            !oddsThreshold &&
            !confidenceThreshold
          ) {
            const target = Math.min(legTarget, MAX_LEGS);
            let topUpPool = rotatePool(context.realOdds, `${trimmed}|${varietySeed}-topup`);
            if (slateDay) topUpPool = filterOddsForSlateDay(topUpPool, slateDay);
            picks = topUpDeepParlayToTarget(
              picks,
              target,
              mergedPropPool,
              topUpPool,
              gameMeta,
              boardBuildOpts,
            );
            picks = scrubExcludedSportsFromPicks(
              picks,
              excludedSports,
              mergedPropPool,
              mergedGameOdds,
              gameMeta,
            );
          }
        }
        if (slateDay) {
          picks = filterPicksForSlateDay(picks, slateDay);
          if (slateDay === "tonight") {
            tonightNote = tonightExhaustedNote({
              tonightRequested: true,
              todayOnlyApplied: todayOnly,
              surviving: picks.length,
              requestedLegs,
            });
          }
        }
        // Belt-and-braces for the 15-leg slip cap: the server prompt already tells
        // the model never to build more than MAX_LEGS legs, but if it ever drifts
        // (e.g. a "100 leg" ask), never RENDER or OFFER more cards than the slip
        // can hold — truncate the resolved picks to MAX_LEGS. These are already
        // REAL, resolved entries, so this only ever drops extras, never fabricates.
        if (picks.length > MAX_LEGS) {
          picks = picks.slice(0, MAX_LEGS);
        }
        // Game-line legs must pass the SAME 10k-run game simulator the Simulator tab
        // uses — drop any ML/spread/total/alt that the sim does not support.
        let gameSimNote = "";
        let gameSimSupplementNote = "";
        let gameSimulations = new Map<string, CoachGameSimEntry>();
        let mergedGameOdds = context.realOdds;
        let coachEvalLinesByGame: Map<string, import("@/lib/api").RealOddsEntry[]> | null = null;
        let teamIdMap: Map<string, import("@/lib/coachGameMonteCarlo").GameTeamIds> | null = null;
        if (fullBoardScanned && fullBoardScanMeta) {
          gameSimulations = fullBoardScanMeta.gameSimulations;
          coachEvalLinesByGame = fullBoardScanMeta.evalLinesByGame;
          mergedGameOdds = mergeOddsEntries(
            context.realOdds,
            ...fullBoardScanMeta.evalLinesByGame.values(),
          );
        } else if (!isAnalyze && picks.some(isGameLinePick)) {
          picks = dedupeSameTeamGameLegs(picks).picks;
          const gameSports = [
            ...new Set(
              picks
                .filter(isGameLinePick)
                .map((p) => p.sport)
                .filter(Boolean),
            ),
          ].filter((s) => !excludedSports.has(s)) as string[];
          const espnGames = (
            await Promise.all(
              gameSports.map((s) => getGames(s).catch(() => [])),
            )
          ).flat();
          const teamIdMapBuilt = buildGameTeamIdMap(espnGames);
          teamIdMap = teamIdMapBuilt;
          const gamesWithLines = new Set(
            picks.filter(isGameLinePick).map((p) => p.game),
          );
          const oddsGames = (
            await Promise.all(gameSports.map((s) => getOdds(s).catch(() => [])))
          ).flat();
          const evalLinesByGame = deepMultiLegParlay
            ? (() => {
                const all = buildEvalLinesForAllGames(oddsGames);
                const pickKeys = buildEvalLinesByGameMap(gamesWithLines, oddsGames);
                for (const [k, v] of pickKeys) all.set(k, v);
                return all;
              })()
            : buildEvalLinesByGameMap(gamesWithLines, oddsGames);
          coachEvalLinesByGame = evalLinesByGame;
          mergedGameOdds = mergeOddsEntries(
            context.realOdds,
            ...evalLinesByGame.values(),
          );
          gameSimulations = await fetchCoachGameSimulationsForPicks(
            picks,
            teamIdMapBuilt,
            abortRef.current?.signal,
            context.realOdds,
            evalLinesByGame,
          );
          if (
            !salvageBuilt &&
            deepMultiLegParlay &&
            !longshotAsk &&
            picks.length < Math.min(legTarget, MAX_LEGS) &&
            propShare(picks) >= 0.35
          ) {
            picks = backfillGameLinesFromEvalScores(
              picks,
              Math.min(legTarget, MAX_LEGS),
              evalLinesByGame,
              gameSimulations,
              {
                realOdds: mergedGameOdds,
                matchupHistory: context.matchupHistory,
                matchupInjuries: context.matchupInjuries,
                maxGameLegs: Math.max(3, Math.ceil(legTarget * 0.35)),
              },
            );
          }
          // Salvage tickets are honest posted lines from the live board — skip the
          // optimizer/sim gates that run before attachPickScores and would drop every
          // leg (no grade/edge yet) or swap them off the named slate (common on WC).
          if (!salvageBuilt) {
            if (!fullBoardScanned) {
              const optimized = optimizeGameLinePicksToBestFinalAi(picks, gameSimulations, {
                evalLinesByGame,
                realOdds: context.realOdds,
                matchupHistory: context.matchupHistory,
                matchupInjuries: context.matchupInjuries,
                excludeMoneyline: composeFromBoard,
              });
              picks = optimized.picks;
              {
                const dedupedAfterOpt = dedupeSameTeamGameLegs(picks);
                picks = dedupedAfterOpt.picks;
              }
              const filtered = filterCoachPicksWithGameSim(picks, gameSimulations, {
                matchupHistory: context.matchupHistory,
                oddsForEdge: mergedGameOdds,
                rejectsOut: reachFull ? parlayRejections : undefined,
              });
              picks = filtered.picks;
              const edgeFiltered = filterNegativeEdgeGameLines(
                picks,
                mergedGameOdds,
                reachFull ? parlayRejections : undefined,
              );
              picks = edgeFiltered.picks;
              gameSimSupplementNote = appendUniqueNote(gameSimSupplementNote, edgeFiltered.note);
              gameSimSupplementNote = appendUniqueNote(gameSimSupplementNote, filtered.note);
              if (filtered.warnings.length > 0 && !gameSimSupplementNote) {
                gameSimSupplementNote = filtered.warnings.join("\n");
              }
            }
            if (
              !fullBoardScanned &&
              !reachBoardEligible &&
              deepMultiLegParlay &&
              propShare(picks) < (longshotAsk ? 0.5 : 0.35) &&
              picks.length < Math.min(legTarget, MAX_LEGS)
            ) {
              let pool = rotatePool(context.realOdds, `${trimmed}|${varietySeed}-props2`);
              if (slateDay) pool = filterOddsForSlateDay(pool, slateDay);
              picks = backfillProps(picks, mergedPropPool, pool, gameMeta, {
                target: Math.min(legTarget, MAX_LEGS),
                ...propBackfillOpts,
              });
            }
          }
        }
        // POST-SIM SALVAGE — model legs grounded then got zeroed by the optimizer /
        // sim gates above, but the live board still has real prices for this slate.
        if (
          !isAnalyze &&
          picks.length === 0 &&
          legTarget > 0 &&
          !oddsThreshold &&
          !confidenceThreshold &&
          !altSign
        ) {
          const tgt = Math.min(legTarget, MAX_LEGS);
          picks = await buildParlaySalvagePicks({ ...salvageBuildOpts, target: tgt });
          if (picks.length > 0) salvageBuilt = true;
        }
        if (forceBoardBuild && !blockUngradedTopUp) {
          let finalPool = rotatePool(context.realOdds, `${trimmed}|${varietySeed}-final`);
          if (slateDay) finalPool = filterOddsForSlateDay(finalPool, slateDay);
          picks = finalizeDeepParlayTicket(
            picks,
            reachTarget,
            mergedPropPool,
            finalPool,
            gameMeta,
            boardBuildOpts,
          );
          if (picks.some(isGameLinePick)) {
            if (!teamIdMap) {
              const finalizeSports = [
                ...new Set(
                  picks
                    .filter(isGameLinePick)
                    .map((p) => p.sport)
                    .filter(Boolean),
                ),
              ] as string[];
              const finalizeEspn = (
                await Promise.all(
                  finalizeSports.map((s) => getGames(s).catch(() => [])),
                )
              ).flat();
              teamIdMap = buildGameTeamIdMap(finalizeEspn);
            }
            if (!coachEvalLinesByGame) {
              const finalizeSports = [
                ...new Set(
                  picks
                    .filter(isGameLinePick)
                    .map((p) => p.sport)
                    .filter(Boolean),
                ),
              ] as string[];
              const finalizeOdds = (
                await Promise.all(
                  finalizeSports.map((s) => getOdds(s).catch(() => [])),
                )
              ).flat();
              const gamesWithLines = new Set(
                picks.filter(isGameLinePick).map((p) => p.game),
              );
              coachEvalLinesByGame = deepMultiLegParlay
                ? buildEvalLinesForAllGames(finalizeOdds)
                : buildEvalLinesByGameMap(gamesWithLines, finalizeOdds);
              mergedGameOdds = mergeOddsEntries(
                context.realOdds,
                ...coachEvalLinesByGame.values(),
              );
            }
            gameSimulations = await supplementCoachGameSimulations(
              picks,
              gameSimulations,
              teamIdMap,
              abortRef.current?.signal,
              mergedGameOdds,
              coachEvalLinesByGame,
            );
          }
          if (gameSimulations.size > 0 && picks.some(isGameLinePick) && coachEvalLinesByGame) {
            picks = dedupeSameTeamGameLegs(picks).picks;
            const reoptimized = optimizeGameLinePicksToBestFinalAi(picks, gameSimulations, {
              evalLinesByGame: coachEvalLinesByGame,
              realOdds: context.realOdds,
              matchupHistory: context.matchupHistory,
              matchupInjuries: context.matchupInjuries,
              excludeMoneyline: true,
            });
            picks = reoptimized.picks;
            picks = dedupeSameTeamGameLegs(picks).picks;
            const postFinalizeSides = enforceConsistentGameSides(picks, {
              simByGame: gameSimulations,
              matchupHistory: context.matchupHistory,
            });
            picks = postFinalizeSides.picks;
            if (postFinalizeSides.dropped > 0) {
              gameSimSupplementNote = appendUniqueNote(
                gameSimSupplementNote,
                postFinalizeSides.note,
              );
            }
            if (teamIdMap && coachEvalLinesByGame) {
              gameSimulations = await supplementCoachGameSimulations(
                picks,
                gameSimulations,
                teamIdMap,
                abortRef.current?.signal,
                mergedGameOdds,
                coachEvalLinesByGame,
              );
            }
          }
        }
        if (!isAnalyze && picks.some(isGameLinePick)) {
          if (!teamIdMap) {
            const noteSports = [
              ...new Set(
                picks
                  .filter(isGameLinePick)
                  .map((p) => p.sport)
                  .filter(Boolean),
              ),
            ] as string[];
            const noteEspn = (
              await Promise.all(noteSports.map((s) => getGames(s).catch(() => [])))
            ).flat();
            teamIdMap = buildGameTeamIdMap(noteEspn);
          }
          if (!coachEvalLinesByGame) {
            const noteSports = [
              ...new Set(
                picks
                  .filter(isGameLinePick)
                  .map((p) => p.sport)
                  .filter(Boolean),
              ),
            ] as string[];
            const noteOdds = (
              await Promise.all(noteSports.map((s) => getOdds(s).catch(() => [])))
            ).flat();
            const gamesWithLines = new Set(
              picks.filter(isGameLinePick).map((p) => p.game),
            );
            coachEvalLinesByGame = deepMultiLegParlay
              ? buildEvalLinesForAllGames(noteOdds)
              : buildEvalLinesByGameMap(gamesWithLines, noteOdds);
            mergedGameOdds = mergeOddsEntries(
              context.realOdds,
              ...coachEvalLinesByGame.values(),
            );
          }
          if (teamIdMap && coachEvalLinesByGame) {
            gameSimulations = await supplementCoachGameSimulations(
              picks,
              gameSimulations,
              teamIdMap,
              abortRef.current?.signal,
              mergedGameOdds,
              coachEvalLinesByGame,
            );
            gameSimulations = aliasCoachGameSimLabels(picks, gameSimulations);
          }
        }
        // Grade each resolved leg with the 5-component pick rubric, from the SAME
        // real context the legs were resolved against (odds carry edge +
        // book-spread, props carry their +EV/spread; matchup history + injuries
        // ground the trend/matchup/injury sub-scores). Honest-or-null: any signal
        // that can't be grounded for a leg stays absent on its card. The grade is
        // DISPLAY-ONLY — every resolved leg the model returned is kept and shown
        // with its real grade; we never drop a leg for grading low, so a requested
        // N-leg ticket is never trimmed by grade.
        picks = attachPickScores(picks, {
          realOdds: mergedGameOdds,
          propPool: mergedPropPool,
          matchupHistory: context.matchupHistory,
          matchupInjuries: context.matchupInjuries,
          perfByFamily: marketPerf,
          playerHistory: context.playerHistory as Record<string, PlayerHistorySlice> | undefined,
          gameSimulations,
        });
        picks = scrubExcludedSportsFromPicks(
          picks,
          excludedSports,
          mergedPropPool,
          mergedGameOdds,
          gameMeta,
        );
        let reachStagedPromotedMains = 0;
        let reachStagedPromotedAlts = 0;
        if (
          !isAnalyze &&
          reachFillEligible &&
          picks.length < reachTarget &&
          !oddsThreshold &&
          !confidenceThreshold
        ) {
          if (!coachEvalLinesByGame) {
            const reachSports = [
              ...new Set(
                [...mergedPropPool.map((e) => e.sport), ...context.realOdds.map((e) => e.sport)].filter(
                  Boolean,
                ),
              ),
            ].filter((s) => !excludedSports.has(s)) as string[];
            const [reachOdds, reachEspn] = await Promise.all([
              Promise.all(reachSports.map((s) => getOdds(s).catch(() => []))).then((rows) =>
                rows.flat(),
              ),
              Promise.all(reachSports.map((s) => getGames(s).catch(() => []))).then((rows) =>
                rows.flat(),
              ),
            ]);
            coachEvalLinesByGame = buildEvalLinesForAllGames(reachOdds);
            mergedGameOdds = mergeOddsEntries(
              context.realOdds,
              ...coachEvalLinesByGame.values(),
            );
            if (!teamIdMap) teamIdMap = buildGameTeamIdMap(reachEspn);
          }
          if (coachEvalLinesByGame && gameSimulations.size === 0 && teamIdMap) {
            gameSimulations = await fetchSlateGameSimulations(
              coachEvalLinesByGame,
              teamIdMap,
              abortRef.current?.signal,
            );
          }
          if (coachEvalLinesByGame && gameSimulations.size > 0) {
            const reachScoreOpts = {
              realOdds: mergedGameOdds,
              propPool: mergedPropPool,
              matchupHistory: context.matchupHistory,
              matchupInjuries: context.matchupInjuries,
              perfByFamily: marketPerf,
              playerHistory: context.playerHistory as Record<string, PlayerHistorySlice> | undefined,
            mlbPlatoon: context.mlbPlatoon,
            mlbGameEnv: context.mlbGameEnv,
              mlbPlatoon: context.mlbPlatoon,
              mlbGameEnv: context.mlbGameEnv,
              gameSimulations,
            };
            const scoredMainProps = attachPickScores(
              mergedPropPool.filter((e) => !e.alt).map(parsedPickFromPoolEntry),
              reachScoreOpts,
            );
            const scoredAltProps = mergedPropPool.some((e) => e.alt)
              ? attachPickScores(
                  mergedPropPool.filter((e) => e.alt).map(parsedPickFromPoolEntry),
                  reachScoreOpts,
                )
              : [];
            const { mains, alts } = collectReachStagedQualifiers(
              picks,
              coachEvalLinesByGame,
              gameSimulations,
              mergedPropPool,
              scoredMainProps,
              scoredAltProps,
              {
                realOdds: mergedGameOdds,
                matchupHistory: context.matchupHistory,
                matchupInjuries: context.matchupInjuries,
                excludedSports,
              },
            );
            const filled = fillReachTicketStaged(picks, reachTarget, mains, alts);
            if (filled.promotedMains.length > 0 || filled.promotedAlts.length > 0) {
              reachStagedPromotedMains += filled.promotedMains.length;
              reachStagedPromotedAlts += filled.promotedAlts.length;
              picks = attachPickScores(filled.picks, reachScoreOpts);
              picks = scrubExcludedSportsFromPicks(
                picks,
                excludedSports,
                mergedPropPool,
                mergedGameOdds,
                gameMeta,
              );
            }
          }
        }
        if (
          forceBoardBuild &&
          !blockUngradedTopUp &&
          !isAnalyze &&
          picks.length < reachTarget &&
          !oddsThreshold &&
          !confidenceThreshold
        ) {
          let latePool = rotatePool(context.realOdds, `${trimmed}|${varietySeed}-late`);
          if (slateDay) latePool = filterOddsForSlateDay(latePool, slateDay);
          if (reachFull && !coachEvalLinesByGame) {
            const reachSports = [
              ...new Set(
                [...mergedPropPool.map((e) => e.sport), ...context.realOdds.map((e) => e.sport)].filter(
                  Boolean,
                ),
              ),
            ].filter((s) => !excludedSports.has(s)) as string[];
            const reachOdds = (
              await Promise.all(reachSports.map((s) => getOdds(s).catch(() => [])))
            ).flat();
            coachEvalLinesByGame = buildEvalLinesForAllGames(reachOdds);
            mergedGameOdds = mergeOddsEntries(
              context.realOdds,
              ...coachEvalLinesByGame.values(),
            );
          }
          if (reachFull) {
            picks = replenishParlayToTarget(picks, reachTarget, {
              longshotAsk,
              plusMoneyBias: propBackfillOpts.plusMoneyBias,
              diversify: propBackfillOpts.diversify,
              varietySeed,
              avoidLegKeys,
              selectionOpts,
              propPool: mergedPropPool,
              realOdds: context.realOdds,
              mergedGameOdds,
              gameMeta,
              evalLinesByGame: coachEvalLinesByGame,
              gameSimulations,
              matchupHistory: context.matchupHistory,
              matchupInjuries: context.matchupInjuries,
            });
          } else if (coachEvalLinesByGame && gameSimulations.size > 0) {
            picks = replenishParlayToTarget(picks, reachTarget, {
              longshotAsk,
              plusMoneyBias: propBackfillOpts.plusMoneyBias,
              diversify: propBackfillOpts.diversify,
              varietySeed,
              avoidLegKeys,
              selectionOpts,
              propPool: mergedPropPool,
              realOdds: context.realOdds,
              mergedGameOdds,
              gameMeta,
              evalLinesByGame: coachEvalLinesByGame,
              gameSimulations,
              matchupHistory: context.matchupHistory,
              matchupInjuries: context.matchupInjuries,
            });
          }
          picks = attachPickScores(picks, {
            realOdds: mergedGameOdds,
            propPool: mergedPropPool,
            matchupHistory: context.matchupHistory,
            matchupInjuries: context.matchupInjuries,
            perfByFamily: marketPerf,
            playerHistory: context.playerHistory as Record<string, PlayerHistorySlice> | undefined,
            mlbPlatoon: context.mlbPlatoon,
            mlbGameEnv: context.mlbGameEnv,
            gameSimulations,
          });
          picks = scrubExcludedSportsFromPicks(
            picks,
            excludedSports,
            mergedPropPool,
            mergedGameOdds,
            gameMeta,
          );
        }
        if (picks.some(isGameLinePick)) {
          const finalDeduped = dedupeCoachGameLinePicks(picks, {
            simByGame: gameSimulations,
            matchupHistory: context.matchupHistory,
          });
          picks = finalDeduped.picks;
          if (finalDeduped.sideNote) {
            gameSimSupplementNote = appendUniqueNote(
              gameSimSupplementNote,
              finalDeduped.sideNote,
            );
          }
          if (finalDeduped.dropped > 0) {
            const dedupeNote = `_Dropped ${finalDeduped.dropped} duplicate or opposing game-line leg${finalDeduped.dropped === 1 ? "" : "s"} on the same matchup._`;
            gameSimSupplementNote = appendUniqueNote(gameSimSupplementNote, dedupeNote);
          }
        }
        if (
          false &&
          !isAnalyze &&
          isParlayBuild &&
          picks.length > 0 &&
          picks.length < legTarget &&
          !oddsThreshold &&
          !confidenceThreshold &&
          !altSign
        ) {
          const beforeTopUp = picks.length;
          picks = await topUpParlayPicks(picks, {
            ...salvageBuildOpts,
            target: Math.min(legTarget, MAX_LEGS),
          });
          if (picks.length > beforeTopUp) {
            picks = attachPickScores(picks, {
              realOdds: mergedGameOdds,
              propPool: mergedPropPool,
              matchupHistory: context.matchupHistory,
              matchupInjuries: context.matchupInjuries,
              perfByFamily: marketPerf,
              playerHistory: context.playerHistory as Record<string, PlayerHistorySlice> | undefined,
            mlbPlatoon: context.mlbPlatoon,
            mlbGameEnv: context.mlbGameEnv,
              mlbPlatoon: context.mlbPlatoon,
              mlbGameEnv: context.mlbGameEnv,
              gameSimulations,
            });
            picks = scrubExcludedSportsFromPicks(
              picks,
              excludedSports,
              mergedPropPool,
              mergedGameOdds,
              gameMeta,
            );
          }
        }
        if (!isAnalyze && picks.some((p) => p.isProp)) {
          const propSides = enforceConsistentPropSides(picks);
          picks = propSides.picks;
          if (propSides.dropped > 0) {
            gameSimSupplementNote = appendUniqueNote(gameSimSupplementNote, propSides.note);
            if (gameSimNote && !gameSimNote.includes(propSides.note)) {
              gameSimNote = appendUniqueNote(gameSimNote, propSides.note);
            } else if (!gameSimNote) {
              gameSimNote = propSides.note;
            }
          }
          const antiFlip = dropPropsOpposingTrackedPicks(picks, trackedPicks);
          picks = antiFlip.picks;
          if (antiFlip.dropped > 0) {
            gameSimSupplementNote = appendUniqueNote(gameSimSupplementNote, antiFlip.note);
            if (gameSimNote && !gameSimNote.includes(antiFlip.note)) {
              gameSimNote = appendUniqueNote(gameSimNote, antiFlip.note);
            } else if (!gameSimNote) {
              gameSimNote = antiFlip.note;
            }
          }
        }
        picks = attachPropPoolLadder(picks, mergedPropPool);
        if (coachEvalLinesByGame && gameSimulations.size > 0) {
          picks = attachSimAltOptionsToPicks(picks, {
            evalLinesByGame: coachEvalLinesByGame,
            gameSimulations,
            realOdds: mergedGameOdds,
            propPool: mergedPropPool,
            matchupHistory: context.matchupHistory,
            matchupInjuries: context.matchupInjuries,
          });
        }
        picks = picksWithSimPending(picks);
        picks = scrubExcludedSportsFromPicks(
          picks,
          excludedSports,
          mergedPropPool,
          mergedGameOdds,
          gameMeta,
        );
        if (excludedSports.size > 0) {
          mergedGameOdds = filterForExcludedSports(mergedGameOdds, excludedSports);
          if (coachEvalLinesByGame) {
            coachEvalLinesByGame = filterEvalLinesByExcludedSports(
              coachEvalLinesByGame,
              excludedSports,
            ) as Map<string, import("@/lib/api").RealOddsEntry[]>;
          }
        }
        // Last reach pass — dedupe / side filters can leave 12+ leg asks short after sim.
        if (
          !isAnalyze &&
          reachFillEligible &&
          picks.length < reachTarget &&
          !oddsThreshold &&
          !confidenceThreshold
        ) {
          if (fullBoardScanned && coachEvalLinesByGame && gameSimulations.size > 0) {
            const reachScoreOpts = {
              realOdds: mergedGameOdds,
              propPool: mergedPropPool,
              matchupHistory: context.matchupHistory,
              matchupInjuries: context.matchupInjuries,
              perfByFamily: marketPerf,
              playerHistory: context.playerHistory as Record<string, PlayerHistorySlice> | undefined,
            mlbPlatoon: context.mlbPlatoon,
            mlbGameEnv: context.mlbGameEnv,
              mlbPlatoon: context.mlbPlatoon,
              mlbGameEnv: context.mlbGameEnv,
              gameSimulations,
            };
            const scoredMainProps = attachPickScores(
              mergedPropPool.filter((e) => !e.alt).map(parsedPickFromPoolEntry),
              reachScoreOpts,
            );
            const scoredAltProps = mergedPropPool.some((e) => e.alt)
              ? attachPickScores(
                  mergedPropPool.filter((e) => e.alt).map(parsedPickFromPoolEntry),
                  reachScoreOpts,
                )
              : [];
            const { mains, alts } = collectReachStagedQualifiers(
              picks,
              coachEvalLinesByGame,
              gameSimulations,
              mergedPropPool,
              scoredMainProps,
              scoredAltProps,
              {
                realOdds: mergedGameOdds,
                matchupHistory: context.matchupHistory,
                matchupInjuries: context.matchupInjuries,
                excludedSports,
              },
            );
            const filled = fillReachTicketStaged(picks, reachTarget, mains, alts);
            if (filled.promotedMains.length > 0 || filled.promotedAlts.length > 0) {
              reachStagedPromotedMains += filled.promotedMains.length;
              reachStagedPromotedAlts += filled.promotedAlts.length;
              picks = attachPickScores(filled.picks, reachScoreOpts);
            }
          } else if (coachEvalLinesByGame && gameSimulations.size > 0) {
            picks = replenishParlayToTarget(picks, reachTarget, {
              longshotAsk,
              plusMoneyBias: propBackfillOpts.plusMoneyBias,
              diversify: propBackfillOpts.diversify,
              varietySeed,
              avoidLegKeys,
              selectionOpts,
              propPool: mergedPropPool,
              realOdds: context.realOdds,
              mergedGameOdds,
              gameMeta,
              evalLinesByGame: coachEvalLinesByGame,
              gameSimulations,
              matchupHistory: context.matchupHistory,
              matchupInjuries: context.matchupInjuries,
            });
          } else if (coachEvalLinesByGame && gameSimulations.size > 0) {
            picks = replenishParlayToTarget(picks, reachTarget, {
              longshotAsk,
              plusMoneyBias: propBackfillOpts.plusMoneyBias,
              diversify: propBackfillOpts.diversify,
              varietySeed,
              avoidLegKeys,
              selectionOpts,
              propPool: mergedPropPool,
              realOdds: context.realOdds,
              mergedGameOdds,
              gameMeta,
              evalLinesByGame: coachEvalLinesByGame,
              gameSimulations,
              matchupHistory: context.matchupHistory,
              matchupInjuries: context.matchupInjuries,
            });
          }
          picks = dedupeSameTeamGameLegs(picks).picks;
          picks = attachPickScores(picks, {
            realOdds: mergedGameOdds,
            propPool: mergedPropPool,
            matchupHistory: context.matchupHistory,
            matchupInjuries: context.matchupInjuries,
            perfByFamily: marketPerf,
            playerHistory: context.playerHistory as Record<string, PlayerHistorySlice> | undefined,
            mlbPlatoon: context.mlbPlatoon,
            mlbGameEnv: context.mlbGameEnv,
            gameSimulations,
          });
          picks = scrubExcludedSportsFromPicks(
            picks,
            excludedSports,
            mergedPropPool,
            mergedGameOdds,
            gameMeta,
          );
        }
        const filterQualifyingAltLegs = (alts: ParsedPick[]) =>
          alts.filter((p) => qualifiesAltPick(p, p.finalAiScore));
        // Transparency note. When the user asked for a specific leg count and we
        // delivered fewer (even after the alt backstop above), say why — the
        // lead-in prose is hidden once cards render (assistantBubbleText returns
        // "" when picks exist), so this is the ONLY place the user learns the
        // ticket was trimmed. Two reasons: (1) tickets cap at the 15-leg slip max,
        // or (2) the real board was too thin to ground that many legs. We never
        // pad with invented legs.
        let legNote = "";
        const oddsPhrase = slateDay ? `${slateLabel} real odds` : "the real odds";
        let backupPicks: ParsedPick[] = [];
        let backupNote = "";
        let qualifyingAlts: ParlayLegReject[] = [];
        if (reachFull && picks.length > 0 && coachEvalLinesByGame) {
          qualifyingAlts = collectQualifyingGameLines(picks, coachEvalLinesByGame, gameSimulations, {
            realOdds: mergedGameOdds,
            matchupHistory: context.matchupHistory,
            matchupInjuries: context.matchupInjuries,
            excludedSports,
          });
        }
        if (reachFull && requestedLegs > picks.length && picks.length > 0) {
          if (!qualifyingAlts.length && coachEvalLinesByGame) {
            qualifyingAlts = collectQualifyingGameLines(picks, coachEvalLinesByGame, gameSimulations, {
              realOdds: mergedGameOdds,
              matchupHistory: context.matchupHistory,
              matchupInjuries: context.matchupInjuries,
              excludedSports,
            });
          }
          const backupTarget = Math.min(4, requestedLegs - picks.length);
          backupPicks = selectParlayBackupPicks(picks, qualifyingAlts, backupTarget);
          if (backupPicks.length > 0) {
            backupPicks = attachPickScores(backupPicks, {
              realOdds: mergedGameOdds,
              propPool: mergedPropPool,
              matchupHistory: context.matchupHistory,
              matchupInjuries: context.matchupInjuries,
              perfByFamily: marketPerf,
              playerHistory: context.playerHistory as Record<string, PlayerHistorySlice> | undefined,
            mlbPlatoon: context.mlbPlatoon,
            mlbGameEnv: context.mlbGameEnv,
              mlbPlatoon: context.mlbPlatoon,
              mlbGameEnv: context.mlbGameEnv,
              gameSimulations,
            });
            backupPicks = filterQualifyingAltLegs(backupPicks);
            if (excludedSports.size > 0) {
              backupPicks = scrubExcludedSportsFromPicks(
                backupPicks,
                excludedSports,
                mergedPropPool,
                mergedGameOdds,
                gameMeta,
              );
            }
            if (backupPicks.length > 0) {
              backupNote = buildQualifyingAltShortfallNote(
                requestedLegs,
                picks.length,
                backupPicks.length,
                oddsPhrase,
                excludeSportsList,
              );
            }
          }
        }
        let reachAltPromoted = reachStagedPromotedAlts;
        if (
          !isAnalyze &&
          reachFillEligible &&
          picks.length < reachTarget &&
          coachEvalLinesByGame &&
          gameSimulations.size > 0
        ) {
          const reachScoreOpts = {
            realOdds: mergedGameOdds,
            propPool: mergedPropPool,
            matchupHistory: context.matchupHistory,
            matchupInjuries: context.matchupInjuries,
            perfByFamily: marketPerf,
            playerHistory: context.playerHistory as Record<string, PlayerHistorySlice> | undefined,
            mlbPlatoon: context.mlbPlatoon,
            mlbGameEnv: context.mlbGameEnv,
            gameSimulations,
          };
          const scoredMainProps = attachPickScores(
            mergedPropPool.filter((e) => !e.alt).map(parsedPickFromPoolEntry),
            reachScoreOpts,
          );
          const scoredAltProps = mergedPropPool.some((e) => e.alt)
            ? attachPickScores(
                mergedPropPool.filter((e) => e.alt).map(parsedPickFromPoolEntry),
                reachScoreOpts,
              )
            : [];
          const { mains, alts } = collectReachStagedQualifiers(
            picks,
            coachEvalLinesByGame,
            gameSimulations,
            mergedPropPool,
            scoredMainProps,
            scoredAltProps,
            {
              realOdds: mergedGameOdds,
              matchupHistory: context.matchupHistory,
              matchupInjuries: context.matchupInjuries,
              excludedSports,
            },
          );
          if (mains.length > 0 || alts.length > 0) {
            const filled = fillReachTicketStaged(picks, reachTarget, mains, alts);
            if (filled.promotedMains.length > 0 || filled.promotedAlts.length > 0) {
              reachStagedPromotedMains += filled.promotedMains.length;
              reachAltPromoted += filled.promotedAlts.length;
              picks = attachPickScores(filled.picks, reachScoreOpts);
              picks = scrubExcludedSportsFromPicks(
                picks,
                excludedSports,
                mergedPropPool,
                mergedGameOdds,
                gameMeta,
              );
            }
          }
        }
        picks = tagTicketRoles(picks);
        let aiFilterNote = "";
        if (
          !isAnalyze &&
          isParlayBuild &&
          earlyReachBoardScanRef.current &&
          !boardScanIsComplete(fullBoardScanMeta) &&
          !boardScanIsComplete(latestBoardScanRef.current)
        ) {
          try {
            const settled = await earlyReachBoardScanRef.current;
            if (settled) {
              latestBoardScanRef.current = settled;
              if (!fullBoardScanMeta || !boardScanIsComplete(fullBoardScanMeta)) {
                fullBoardScanMeta = preferFinalBoardScanForDelivery(
                  reachTarget,
                  settled,
                  fullBoardScanMeta,
                  preBoardScan,
                );
              }
              if (boardScanIsComplete(settled)) fullBoardScanned = true;
            }
          } catch {
            /* ignore */
          }
        }
        let boardScanManifestDetail = "";
        const ticketEnrich = { ...pickEnrich, realOdds: mergedGameOdds };
        if (
          !isAnalyze &&
          isParlayBuild &&
          fullBoardScanned &&
          fullBoardScanMeta &&
          boardScanIsComplete(fullBoardScanMeta)
        ) {
          const delivered = deliverCoachBoardScanTicket(
            fullBoardScanMeta,
            {
              ...ticketEnrich,
              realOdds: [
                ...mergedGameOdds,
                ...(fullBoardScanMeta.evalLinesByGame
                  ? [...fullBoardScanMeta.evalLinesByGame.values()].flat()
                  : []),
              ],
            },
            reachTarget,
          );
          picks = delivered.picks;
          boardScanManifestDetail = delivered.coachDetailNote;
        } else if (!isAnalyze && isParlayBuild && picks.length > 0) {
          const beforeFilter = picks.length;
          const finalized = finalizeCoachTicketPicks(picks, ticketEnrich);
          picks = finalized.picks;
          if (picks.length < beforeFilter && picks.length > 0) {
            aiFilterNote = finalized.usedRescoringFallback
              ? `_Rescoring adjusted grades on ${beforeFilter - picks.length} line(s) — kept sim-aligned legs with positive edge on your ticket._`
              : `_Only legs that pass sim, edge, EV, and confidence thresholds stay on the ticket — ${beforeFilter - picks.length} weaker line(s) removed._`;
          }
        }
        if (coachEvalLinesByGame && gameSimulations.size > 0 && picks.some(isGameLinePick)) {
          const optimizerNote = buildGameLineOptimizerNote(picks, gameSimulations, {
            evalLinesByGame: coachEvalLinesByGame,
            realOdds: mergedGameOdds,
            matchupHistory: context.matchupHistory,
            matchupInjuries: context.matchupInjuries,
          });
          gameSimNote = optimizerNote
            ? gameSimSupplementNote
              ? `${optimizerNote}\n\n${gameSimSupplementNote}`
              : optimizerNote
            : gameSimSupplementNote;
        } else if (gameSimSupplementNote) {
          gameSimNote = gameSimSupplementNote;
        }
        if (picks.length > 0 && ticketTarget > picks.length) {
          const altOnTicket = picks.filter((p) => p.ticketRole === "alt").length;
          const mainOnTicket = picks.length - altOnTicket;
          const stagingForNote = fullBoardScanMeta?.staging
            ? {
                ...fullBoardScanMeta.staging,
                mainOnTicket,
                altOnTicket,
              }
            : {
                mainQualified: mainOnTicket + reachStagedPromotedMains,
                altQualified: altOnTicket + reachAltPromoted,
                mainOnTicket,
                altOnTicket,
              };
          legNote =
            fullBoardScanned && fullBoardScanMeta
              ? buildFullBoardShortfallNote(
                  ticketTarget,
                  picks.length,
                  fullBoardScanMeta.totalScanned,
                  fullBoardScanMeta.totalQualified,
                  oddsPhrase,
                  excludeSportsList,
                  stagingForNote,
                )
              : ticketTarget > MAX_LEGS && picks.length >= MAX_LEGS
                ? `Tickets cap at ${MAX_LEGS} legs — here's the strongest ${MAX_LEGS}-leg version of your ${ticketTarget}-leg request.`
                : backupNote ||
                  buildQualifyingAltShortfallNote(
                    ticketTarget,
                    picks.length,
                    altOnTicket > 0 ? altOnTicket : backupPicks.length,
                    oddsPhrase,
                    excludeSportsList,
                  );
        } else if (picks.length > 0 && fullBoardScanned && fullBoardScanMeta) {
          const altOnTicket = picks.filter((p) => p.ticketRole === "alt").length;
          const mainOnTicket = picks.length - altOnTicket;
          legNote = buildFullBoardShortfallNote(
            ticketTarget,
            picks.length,
            fullBoardScanMeta.totalScanned,
            fullBoardScanMeta.totalQualified,
            oddsPhrase,
            excludeSportsList,
            {
              ...fullBoardScanMeta.staging,
              mainOnTicket,
              altOnTicket,
            },
          );
        }
        // Transparency notes (diversity, sim optimizer, ml lean) belong in zero-card
        // failures only — never above rendered pick cards.
        const legNoteForCards =
          picks.length > 0
            ? fullBoardScanned && fullBoardScanMeta
              ? buildFullBoardShortfallNote(
                  ticketTarget,
                  picks.length,
                  fullBoardScanMeta.totalScanned,
                  fullBoardScanMeta.totalQualified,
                  oddsPhrase,
                  excludeSportsList,
                  fullBoardScanMeta.staging
                    ? {
                        ...fullBoardScanMeta.staging,
                        mainOnTicket: picks.filter((p) => p.ticketRole !== "alt").length,
                        altOnTicket: picks.filter((p) => p.ticketRole === "alt").length,
                      }
                    : undefined,
                )
              : ticketTarget > picks.length
                ? legNote
                : ""
            : "";
        const exclusionNote =
          excludedSports.size > 0
            ? `_Leagues excluded on this ticket: **${[...excludedSports].map((s) => s.toUpperCase()).join(", ")}** — say an league name to include it again (e.g. "15 leg MLB parlay")._`
            : "";
        if (
          picks.length === 0 &&
          fullBoardScanned &&
          fullBoardScanMeta &&
          boardScanIsComplete(fullBoardScanMeta)
        ) {
          const scanEnrich = {
            ...ticketEnrich,
            realOdds: [
              ...mergedGameOdds,
              ...(fullBoardScanMeta.evalLinesByGame
                ? [...fullBoardScanMeta.evalLinesByGame.values()].flat()
                : []),
            ],
          };
          const delivered = deliverCoachBoardScanTicket(fullBoardScanMeta, scanEnrich, ticketTarget);
          picks = delivered.picks;
          boardScanManifestDetail = delivered.coachDetailNote;
        } else if (
          picks.length === 0 &&
          fullBoardScanMeta &&
          boardScanIsComplete(fullBoardScanMeta)
        ) {
          const scanEnrich = {
            ...ticketEnrich,
            realOdds: [
              ...mergedGameOdds,
              ...(fullBoardScanMeta.evalLinesByGame
                ? [...fullBoardScanMeta.evalLinesByGame.values()].flat()
                : []),
            ],
          };
          boardScanManifestDetail = coachBoardScanManifestForMessage(
            fullBoardScanMeta,
            scanEnrich,
            ticketTarget,
          );
        } else if (
          picks.length === 0 &&
          latestBoardScanRef.current &&
          boardScanIsComplete(latestBoardScanRef.current)
        ) {
          boardScanManifestDetail = coachBoardScanManifestForMessage(
            latestBoardScanRef.current,
            ticketEnrich,
            ticketTarget,
          );
        }
        if (!boardScanManifestDetail.trim()) {
          const scanForManifest = preferFinalBoardScanForDelivery(
            ticketTarget,
            fullBoardScanMeta,
            latestBoardScanRef.current,
            preBoardScan,
          );
          if (scanForManifest && boardScanIsComplete(scanForManifest)) {
            boardScanManifestDetail = coachBoardScanManifestForMessage(
              scanForManifest,
              ticketEnrich,
              ticketTarget,
            );
          }
        }
        const coachDetailNote = dedupeLegNoteParagraphs(
          [boardScanManifestDetail, exclusionNote, diversityNote, gameSimNote, mlLeanNote, propsOnlyNote, tonightNote, aiFilterNote]
            .filter(Boolean)
            .join("\n\n"),
        );
        if (picks.length === 0) {
          if (mlLeanNote) {
            legNote = legNote ? `${legNote}\n\n${mlLeanNote}` : mlLeanNote;
          }
          if (diversityNote) {
            legNote = legNote ? `${legNote}\n\n${diversityNote}` : diversityNote;
          }
          if (propsOnlyNote) {
            legNote = legNote ? `${legNote}\n\n${propsOnlyNote}` : propsOnlyNote;
          }
          if (tonightNote) {
            legNote = legNote ? `${legNote}\n\n${tonightNote}` : tonightNote;
          }
          if (gameSimNote) {
            legNote = legNote ? `${legNote}\n\n${gameSimNote}` : gameSimNote;
          }
        }
        legNote = dedupeLegNoteParagraphs(picks.length > 0 ? legNoteForCards : legNote);
        if (picks.length === 0 && isParlayBuild && ticketTarget > 0 && boardScanManifestDetail.trim()) {
          legNote = ensureFixedLegShortfallLegNote(
            legNote,
            ticketTarget,
            0,
          );
        }
        if (picks.length > 0 && ticketTarget > picks.length) {
          const scanSettled =
            !fullBoardScanned ||
            !fullBoardScanMeta ||
            boardScanIsComplete(fullBoardScanMeta);
          if (scanSettled) {
            legNote = ensureFixedLegShortfallLegNote(legNote, ticketTarget, picks.length);
          } else {
            const progressLead = `Full-board scan still running — **${picks.length}** leg${picks.length === 1 ? "" : "s"} scored so far.`;
            legNote = legNote.includes(progressLead) ? legNote : `${progressLead}\n\n${legNote}`;
          }
          if (!fullBoardScanned) {
            const progressLead = `Full-board scan did not finish — showing the **${picks.length}** highest-rated picks found so far.`;
            legNote = legNote.includes(progressLead) ? legNote : `${progressLead}\n\n${legNote}`;
          }
        }
        // Never leave an empty, invisible assistant bubble. A parlay reply renders
        // blank when the model emitted PICK lines but NONE resolved to a real odds
        // entry (board thin / between updates): the cards are empty AND
        // assistantBubbleText() strips the raw PICK scaffold down to nothing — and
        // any note appended AFTER those PICK lines gets stripped too. So drop the
        // unbacked scaffold and keep only the lead-in prose plus an honest note
        // (the threshold note when the ask carried an odds bound), guaranteeing a
        // successful request never shows as a blank reply.
        let finalContent =
          full + thresholdNote + confidenceNote + signNote + todayNote;
        if ((salvageBuilt || boardBuilt || soccerScorerGkSalvage) && picks.length > 0) {
          // Board-built / salvage tickets replace model prose (often chalk scaffold
          // or placeholder optimizer copy) with a clean lead-in. legNote carries
          // the honest diversity + sim transparency notes below the cards.
          finalContent = soccerScorerGkSalvage
            ? "No WC matches kick off today — here are the top posted scorer lines from the next slate. xG, keeper save %, and clean-sheet rates aren't in our feed; these cards use real anytime-goal and shots-on-target props only."
            : boardBuilt
            ? `Here's your ${reachTarget}-leg ticket from today's live board — player props and alt rungs, scored with the 10k sim and Final AI.`
            : "Here's the strongest real ticket today's slate supports right now — every leg is a live price, nothing invented.";
        } else if (
          picks.length === 0 &&
          (emittedPickLines > 0 || requestedLegs > 0 || isParlayBuild)
        ) {
          const partitioned = partitionCoachNotes(legNote, coachDetailNote);
          const hasManifestReply = coachReplyHasScanManifest(
            boardScanManifestDetail,
            coachDetailNote,
          );
          const note =
            hasManifestReply
              ? "_Full board scan finished — no legs cleared delivery gates. Open **View scan manifest** below for coverage and rejection reasons._"
              : todayNote ||
            thresholdNote ||
            confidenceNote ||
            signNote ||
            partitioned.shortfall ||
            aiFilterNote ||
            (emittedPickLines > 0
              ? "_I couldn't ground any of those legs in the real odds right now — the board may be thin or between updates. Try again in a moment, or ask for a specific game or market._"
              : "_I couldn't ground a real ticket from the live board right now — try again in a moment, or name a sport or game._");
          finalContent = note.trim();
        }
        // Absolute backstop for any other blank reply (e.g. an empty stream) so a
        // 200 with no visible content never lands as a silent dead end.
        if (picks.length === 0 && assistantBubbleText(finalContent, false).trim() === "") {
          finalContent = coachReplyHasScanManifest(boardScanManifestDetail, coachDetailNote)
            ? "_Full board scan finished — no legs cleared delivery gates. Open **View scan manifest** below for coverage and rejection reasons._"
            : "I couldn't put together a grounded reply just now — the live board may be thin or between updates. Try again in a moment, or ask for a specific game, player, or market.";
        }
        if (isParlayBuild && legTarget >= 3) {
          picks = stripFillerBackfillPicks(picks);
        }
        if (isParlayBuild && picks.length > 1 && !fullBoardScanned && !didReachFullPreScan) {
          picks = rotateParlayDisplayOrder(picks, varietySeed);
        }
        const boardSnapshot = boardTicketSnapshotRef.current;
        const resolveOutPicks = (existingPicks?: ParsedPick[]) => {
          if (
            fullBoardScanned &&
            fullBoardScanMeta &&
            !boardScanIsComplete(fullBoardScanMeta)
          ) {
            return existingPicks?.length ? existingPicks : [];
          }
          if (didReachFullPreScan) {
            const liveFinal = preferFinalBoardScanForDelivery(
              legTarget,
              fullBoardScanMeta,
              preBoardScan,
              latestBoardScanRef.current,
            );
            if (liveFinal?.picks?.length) {
              const ticket = boardScanPartialToTicket(liveFinal, ticketEnrich, legTarget);
              if (ticket.length) {
                return prepareCoachDeliveredTicket(
                  isParlayBuild && legTarget >= 3 ? stripFillerBackfillPicks(ticket) : ticket,
                  ticketEnrich,
                );
              }
            }
            if (!freshBoardScanComplete) {
              return existingPicks?.length ? existingPicks : [];
            }
          }
          const raw =
            picks.length > 0
              ? picks
              : fullBoardScanned && boardScanIsComplete(fullBoardScanMeta ?? undefined)
                ? picks
                : boardSnapshot?.length
                  ? boardSnapshot
                  : existingPicks?.length
                    ? existingPicks
                    : picks;
          return prepareCoachDeliveredTicket(
            isParlayBuild && legTarget >= 3
              ? stripFillerBackfillPicks(raw)
              : raw,
            ticketEnrich,
          );
        };
        const gateResolvedPicks = (resolved: ParsedPick[]): ParsedPick[] => {
          if (!resolved.length || legTarget < 3) return resolved;
          const finalized = finalizeCoachTicketForRequest(resolved, {
            requestedLegs: legTarget,
            requestId: coachRequestContextRef.current?.requestId,
            previousRequestId: coachRequestContextRef.current?.previousRequestId,
            cacheKey: coachRequestContextRef.current?.cacheKey,
            source: "resolveOutPicks",
            recordDelivered: true,
          });
          return finalized.ok ? finalized.picks : [];
        };
        let outPicks: ParsedPick[] = [];
        let outCoachDetailNote = "";
        setMessages((prev) => {
          const copy = [...prev];
          const { legNote: _dropLegNote, ...prevAssistant } = copy[copy.length - 1];
          outPicks = gateResolvedPicks(resolveOutPicks(prevAssistant.picks));
          outCoachDetailNote = dedupeLegNoteParagraphs(
            [coachDetailNote, prevAssistant.coachDetailNote ?? ""].filter(Boolean).join("\n\n"),
          );
          const manifestReply = coachReplyHasScanManifest(
            boardScanManifestDetail,
            outCoachDetailNote,
          );
          copy[copy.length - 1] = {
            ...prevAssistant,
            role: "assistant",
            content: outPicks.length > 0 ? "" : manifestReply ? "" : finalContent,
            picks: outPicks,
            ...(legNote.trim() ? { legNote: legNote.trim() } : {}),
            ...(ticketTarget > 0 && isParlayBuild ? { ticketLegTarget: ticketTarget } : {}),
            ...(outCoachDetailNote.trim() ? { coachDetailNote: outCoachDetailNote.trim() } : {}),
            ...(backupPicks.length ? { backupPicks, backupNote } : {}),
          };
          return copy;
        });
        if (outPicks.length > 0) {
          boardTicketSnapshotRef.current = outPicks;
          setStreaming(false);
          setWaiting(false);
          setBuildFinishing(false);
          setBuildProgressExpired(false);
          setParlayBuildPhase("idle");
          setAiPicks(outPicks);
          captureFromCoach(outPicks);
        } else if (isParlayBuild && coachReplyHasScanManifest(boardScanManifestDetail, outCoachDetailNote)) {
          setStreaming(false);
          setWaiting(false);
          setBuildFinishing(false);
          setBuildProgressExpired(false);
          setParlayBuildPhase("idle");
        }
        // Server-side Monte Carlo: quick tier first, deep tier refines in the
        // background. Picks are already on screen — simulation is one rubric input.
        if (picks.some((p) => p.isProp)) {
          simAbortRef.current?.abort();
          const simController = new AbortController();
          simAbortRef.current = simController;
          const simOpts = {
            propPool: mergedPropPool,
            matchupHistory: context.matchupHistory,
            matchupInjuries: context.matchupInjuries,
            playerHistory: context.playerHistory as Record<string, PlayerHistorySlice> | undefined,
            mlbPlatoon: context.mlbPlatoon,
            mlbGameEnv: context.mlbGameEnv,
            perfByFamily: marketPerf,
            minLegs: undefined,
            excludedSports: excludedSports.size > 0 ? excludedSports : undefined,
            altAttach:
              coachEvalLinesByGame && gameSimulations.size > 0
                ? {
                    evalLinesByGame: coachEvalLinesByGame,
                    gameSimulations,
                    realOdds: mergedGameOdds,
                  }
                : undefined,
          };
          const snapshot = scrubExcludedSportsFromPicks(
            picks,
            excludedSports,
            mergedPropPool,
            mergedGameOdds,
            gameMeta,
          );
          const applySimPicks = (scored: ParsedPick[], tier: "quick" | "deep") => {
            let next = scored.map((p) => {
              if ((p.simAltLines?.length ?? 0) > 0) return p;
              return attachPropPoolLadder([p], mergedPropPool)[0] ?? p;
            });
            next = tagTicketRoles(next);
            if (
              reachFillEligible &&
              next.length < reachTarget &&
              coachEvalLinesByGame &&
              gameSimulations.size > 0
            ) {
              const reachScoreOpts = {
                realOdds: mergedGameOdds,
                propPool: mergedPropPool,
                matchupHistory: context.matchupHistory,
                matchupInjuries: context.matchupInjuries,
                perfByFamily: marketPerf,
                playerHistory: context.playerHistory as Record<string, PlayerHistorySlice> | undefined,
            mlbPlatoon: context.mlbPlatoon,
            mlbGameEnv: context.mlbGameEnv,
                gameSimulations,
              };
              const scoredMainProps = attachPickScores(
                mergedPropPool.filter((e) => !e.alt).map(parsedPickFromPoolEntry),
                reachScoreOpts,
              );
              const scoredAltProps = mergedPropPool.some((e) => e.alt)
                ? attachPickScores(
                    mergedPropPool.filter((e) => e.alt).map(parsedPickFromPoolEntry),
                    reachScoreOpts,
                  )
                : [];
              const { mains, alts } = collectReachStagedQualifiers(
                next,
                coachEvalLinesByGame,
                gameSimulations,
                mergedPropPool,
                scoredMainProps,
                scoredAltProps,
                {
                  realOdds: mergedGameOdds,
                  matchupHistory: context.matchupHistory,
                  matchupInjuries: context.matchupInjuries,
                  excludedSports,
                },
              );
              if (mains.length > 0 || alts.length > 0) {
                const filled = fillReachTicketStaged(next, reachTarget, mains, alts);
                if (filled.promotedMains.length > 0 || filled.promotedAlts.length > 0) {
                  next = attachPickScores(filled.picks, reachScoreOpts);
                }
              }
            }
            next = finalizeCoachTicketPicks(next, {
              ...pickEnrich,
              realOdds: mergedGameOdds,
            }).picks;
            if (next.length === 0 && snapshot.length > 0) {
              const salvaged = finalizeCoachTicketPicks(snapshot, {
                ...pickEnrich,
                realOdds: mergedGameOdds,
              }).picks;
              if (salvaged.length > 0) next = salvaged;
            }
            if (
              next.length === 0 &&
              fullBoardScanned &&
              fullBoardScanMeta?.picks?.length &&
              boardScanReadyForDelivery(fullBoardScanMeta, ticketTarget)
            ) {
              const scanEnrich = {
                ...pickEnrich,
                realOdds: [
                  ...mergedGameOdds,
                  ...(fullBoardScanMeta.evalLinesByGame
                    ? [...fullBoardScanMeta.evalLinesByGame.values()].flat()
                    : []),
                ],
              };
              const delivered = deliverCoachBoardScanTicket(
                fullBoardScanMeta,
                scanEnrich,
                ticketTarget,
              );
              next = delivered.picks;
              if (!next.length) {
                next = coachBoardScanTicketPicks(
                  tagTicketRoles([...fullBoardScanMeta.picks]),
                  scanEnrich,
                ).slice(0, ticketTarget);
              }
            }
            next = scrubExcludedSportsFromPicks(
              next,
              excludedSports,
              mergedPropPool,
              mergedGameOdds,
              gameMeta,
            );
            next = prepareCoachDeliveredTicket(next, {
              ...pickEnrich,
              realOdds: mergedGameOdds,
            });
            if (ticketTarget >= 3) {
              const finalized = finalizeCoachTicketForRequest(next, {
                requestedLegs: ticketTarget,
                requestId: coachRequestContextRef.current?.requestId,
                previousRequestId: coachRequestContextRef.current?.previousRequestId,
                cacheKey: coachRequestContextRef.current?.cacheKey,
                source: `applySimPicks-${tier}`,
                recordDelivered: tier === "deep",
              });
              if (!finalized.ok) return;
              next = finalized.picks;
              if (tier === "deep") liveScanDeliveredRef.current = true;
            }
            // Progressive rescoring must never wipe pick cards already on screen.
            if (next.length === 0 && (boardTicketSnapshotRef.current?.length ?? 0) > 0) return;
            let simLegNote: string | undefined;
            if (tier === "deep" && next.length > 0) {
              const upgraded = coachTicketUpgraded(snapshot, next);
              void notifyCoachTicketOptimized(next.length, upgraded);
              if (upgraded) {
                simLegNote =
                  "_Full 10k simulation found a stronger main or alt line — pick cards updated._";
              }
            }
            if (ticketTarget > 0 && next.length < ticketTarget) {
              const altOnTicket = next.filter((p) => p.ticketRole === "alt").length;
              const mainOnTicket = next.length - altOnTicket;
              const oddsPhraseSim = slateDay ? `${slateLabel} real odds` : "the real odds";
              const stagingForSim = fullBoardScanMeta?.staging
                ? { ...fullBoardScanMeta.staging, mainOnTicket, altOnTicket }
                : { mainQualified: mainOnTicket, altQualified: altOnTicket, mainOnTicket, altOnTicket };
              const shortfall =
                fullBoardScanned && fullBoardScanMeta
                  ? buildFullBoardShortfallNote(
                      ticketTarget,
                      next.length,
                      fullBoardScanMeta.totalScanned,
                      fullBoardScanMeta.totalQualified,
                      oddsPhraseSim,
                      excludeSportsList,
                      stagingForSim,
                    )
                  : buildQualifyingAltShortfallNote(
                      ticketTarget,
                      next.length,
                      altOnTicket,
                      oddsPhraseSim,
                      excludeSportsList,
                    );
              simLegNote = simLegNote ? `${simLegNote}\n\n${shortfall}` : shortfall;
            }
            patchLastAssistantPicks(setMessages, next, simLegNote);
            boardTicketSnapshotRef.current = next;
            setStreaming(false);
            setWaiting(false);
            setBuildFinishing(false);
            setBuildProgressExpired(false);
            setParlayBuildPhase("idle");
            setAiPicks(next);
            captureFromCoach(next);
          };
          void loadPropSimulationsProgressive(
            snapshot,
            simOpts,
            {
              onQuick: (scored) => {
                if (simController.signal.aborted) return;
                applySimPicks(scored, "quick");
              },
              onDeep: (scored) => {
                if (simController.signal.aborted) return;
                applySimPicks(scored, "deep");
              },
            },
            simController.signal,
          );
        }
      } catch (e: any) {
        if (handedOffRef.current) {
          // We deliberately aborted the in-app stream to hand the build off to
          // the server when the app was backgrounded. It keeps generating and
          // will push when ready — replace the empty placeholder with a status
          // line instead of a connection-error line. pendingBgRef stays set so
          // the AppState "active" handler auto-restores the finished ticket.
          handedOffRef.current = false;
          // Start polling the server stash so the finished ticket replays (or a
          // stalled build surfaces a retry) even if the user just stays on this
          // screen and never re-foregrounds the app.
          const handedBuildId = pendingBgRef.current?.buildId;
          if (handedBuildId) setBgWatchId(handedBuildId);
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = {
              role: "assistant",
              content:
                "Still building your ticket — I'll keep going even though you stepped away and send you a notification the moment it's ready.",
            };
            return copy;
          });
        } else if (e?.name === "AbortError" || isAbortLikeError(e)) {
          if (isParlayBuildAsk(trimmed)) {
            const partial = latestBoardScanRef.current;
            if (partial?.picks?.length) {
              deliverBoardScanTicket(partial);
            } else {
              tryInstantSlateSeedDelivery(
                requestedLegCount(trimmed) || effectiveBuildLegCount(trimmed),
              );
            }
          }
        } else {
          const failMsg =
            hasOutgoingImages && !(e instanceof ChatStreamError)
              ? "Sorry — I couldn't finish reading your slip photo. Check your connection and try again."
              : chatStreamFailureMessage(e);
          const internalBug =
            e instanceof ReferenceError ||
            (e instanceof Error &&
              (/doesn't exist/i.test(e.message) ||
                /is not defined/i.test(e.message) ||
                /^Property '/i.test(e.message)));
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = {
              role: "assistant",
              content: internalBug
                ? "Something went wrong while building your ticket. Tap below to try again."
                : failMsg,
              ...(isParlayBuildAsk(trimmed) ? { retry: trimmed, parlayBuild: true } : {}),
            };
            return copy;
          });
        }
      } finally {
        if (sendGenerationRef.current !== sendGen) return;
        const scanStillActive = boardScanInFlightRef.current || boardScanStillRunning();
        if (isParlayBuildAsk(trimmed) && !scanStillActive) {
          if (!boardTicketSnapshotRef.current?.length) {
            deliverPendingBoardScanIfReady();
          }
          const partial = latestBoardScanRef.current;
          if (partial?.picks?.length && !boardTicketSnapshotRef.current?.length) {
            if (boardScanIsComplete(partial)) {
              deliverBoardScanTicket(partial);
            } else {
              patchInstantBoardScanTicket(partial, undefined, {
                ticketLegTarget:
                  requestedLegCount(trimmed) || effectiveBuildLegCount(trimmed),
              });
            }
          } else if (
            !boardTicketSnapshotRef.current?.length &&
            boardScanIsComplete(partial ?? undefined)
          ) {
            tryInstantSlateSeedDelivery(
              requestedLegCount(trimmed) || effectiveBuildLegCount(trimmed),
            );
          }
        }
        if (scanStillActive && isParlayBuildAsk(trimmed)) {
          setBuildFinishing(true);
          setBoardScanAwaiting(true);
          setParlayBuildPhase("board-scan");
          if (buildProgressTimerRef.current) {
            clearTimeout(buildProgressTimerRef.current);
            buildProgressTimerRef.current = null;
          }
          releaseOtaBlock();
          abortRef.current = null;
          scrollToEnd(false);
          return;
        }
        const partialAfterSend = latestBoardScanRef.current;
        const pendingScanDelivery =
          isParlayBuildAsk(trimmed) &&
          !boardTicketSnapshotRef.current?.length &&
          boardScanIsComplete(partialAfterSend ?? undefined) &&
          (partialAfterSend?.picks?.length ?? 0) > 0;
        if (pendingScanDelivery) {
          deliverPendingBoardScanIfReady();
          setBuildFinishing(true);
          setBoardScanAwaiting(true);
          setParlayBuildPhase("board-scan");
          if (partialAfterSend) {
            setBoardScanLiveProgress(deriveBoardScanLiveProgress(partialAfterSend));
            setBoardScanPartialLegs(partialAfterSend.picks.length);
          }
          releaseOtaBlock();
          abortRef.current = null;
          scrollToEnd(false);
          return;
        }
        if (buildProgressTimerRef.current) {
          clearTimeout(buildProgressTimerRef.current);
          buildProgressTimerRef.current = null;
        }
        clearBuildStallWatchdog();
        releaseOtaBlock();
        clearParlayBuildUiFlags();
        abortRef.current = null;
        scrollToEnd();
      }
    },
    [
      messages,
      slipForContext,
      streaming,
      buildFinishing,
      scrollToEnd,
      deliverCoachTicket,
      deliverBoardScanTicket,
      deliverKernelBoardScan,
      deliverPendingBoardScanIfReady,
      flashBoardScanResult,
      flashCoachTicketPicks,
      tryInstantSlateSeedDelivery,
      patchInstantBoardScanTicket,
      boardScanPartialToTicket,
      armBuildProgressWatchdog,
      armBuildStallWatchdog,
      clearBuildStallWatchdog,
      onBoardScanPartial,
      kickoffEarlyReachBoardScan,
      watchBoardScanCompletion,
      clearParlayBuildUiFlags,
      boardScanStillRunning,
      attachedImages,
      isSignedIn,
      modelStrengths,
      marketPerf,
    ],
  );

  // Restore a parlay the server finished in the background: marry the LOCAL
  // saved context (same odds/props the model used) with the server's stashed
  // reply + prop pool, then replay them through the normal render path. Honest
  // by construction — both halves are real; if either is missing we surface a
  // note rather than inventing anything. `auto` suppresses the not-ready/other-
  // device notes (used by the AppState foreground retry, which fires often).
  const restoreBackgroundBuild = useCallback(
    async (buildId: string, opts?: { auto?: boolean }) => {
      if (!buildId || streamingRef.current) return;
      if (restoredBuildRef.current === buildId) return;
      // Serialize concurrent triggers (poll + AppState "active" + push tap).
      if (restoringRef.current) return;
      restoringRef.current = true;
      try {
        const pending = await loadPendingBuild();
        // Only fetch the server stash when there's a local pending record to
        // marry it with (and to avoid a needless authenticated GET otherwise).
        const stash = pending
          ? (await getSync<CoachBuildStash>("coachBuild")).data
          : null;
        // Re-check after the awaits: another path may have started a stream or
        // already restored this build while we were fetching.
        if (streamingRef.current || restoredBuildRef.current === buildId) return;
        // Pure decision (lib/backgroundBuild.ts): which of wrong-device /
        // not-ready / failed / replay applies. The side effects below stay here.
        const decision = decideBackgroundRestore(buildId, pending, stash, {
          now: Date.now(),
          maxWaitMs: pending
            ? pendingBuildMaxWaitMs(pending.userText)
            : PENDING_BUILD_MAX_WAIT_MS,
        });
        if (decision.action === "wrong-device") {
          if (!opts?.auto) {
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content:
                  "I finished that ticket, but I can only rebuild it on the device you started it on.",
              },
            ]);
          }
          return;
        }
        if (decision.action === "not-ready") {
          if (!opts?.auto) {
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: "Still finishing that ticket — give it a moment and tap the notification again.",
              },
            ]);
          }
          return;
        }
        if (decision.action === "failed") {
          // Terminal failure the server recorded: the build stalled (timedOut) or
          // errored (failed) while the app was away, and NO ticket was stashed
          // (honesty — we never deliver a half-finished parlay). Show a clear,
          // non-fabricated recovery message with a "Try again" affordance instead
          // of a blank/last-state screen. Fires even in `auto` mode so a returning
          // user always learns the build didn't make it.
          restoredBuildRef.current = buildId;
          pendingBgRef.current = null;
          setBgWatchId(null);
          const retryText = decision.retryText;
          await clearPendingBuild();
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                decision.status === "timedOut"
                  ? "I couldn't finish that ticket in time — the build stalled while you were away, so nothing was saved. Tap below to try again."
                  : "I couldn't finish that ticket — something went wrong on my end while you were away, so nothing was saved. Tap below to try again.",
              ...(retryText ? { retry: retryText } : {}),
            },
          ]);
          return;
        }
        restoredBuildRef.current = buildId;
        pendingBgRef.current = null;
        setBgWatchId(null);
        await clearPendingBuild();
        await send(pending!.userText, { replay: decision.payload });
      } catch {
        // Transient (token not ready / offline / 401) — leave the pending record
        // so a later foreground or notification tap can retry. Never fabricate.
      } finally {
        restoringRef.current = false;
      }
    },
    [send],
  );

  // Re-arm in-memory watch state from AsyncStorage after a kill/relaunch (refs
  // and bgWatchId are lost, but the pending record survives) and kick a stash
  // check so a finished ticket replays without waiting for a push tap.
  const resumePendingBackgroundBuild = useCallback(async () => {
    if (streamingRef.current) return;
    const pending = await loadPendingBuild();
    if (!pending) return;
    if (restoredBuildRef.current === pending.buildId) return;
    pendingBgRef.current = { buildId: pending.buildId };
    setBgWatchId(pending.buildId);
    await restoreBackgroundBuild(pending.buildId, { auto: true });
  }, [restoreBackgroundBuild]);

  // Hand a build off to the server when the app is backgrounded mid-stream, and
  // pull the finished result back when the user returns.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        // Leaving mid-build: stop THIS attempt (its socket is about to freeze and
        // would just burn retries) but DON'T discard it — the server keeps going
        // and pushes when done. The local pending record drives the replay.
        if (
          shouldAbortForHandoff({
            streaming: streamingRef.current,
            hasPendingBackground: !!pendingBgRef.current,
          })
        ) {
          handedOffRef.current = true;
          abortRef.current?.abort();
        }
      } else if (state === "active") {
        const pend = pendingBgRef.current;
        if (pend && !streamingRef.current) {
          void restoreBackgroundBuild(pend.buildId, { auto: true });
        } else if (!streamingRef.current) {
          void resumePendingBackgroundBuild();
        }
      }
    });
    return () => sub.remove();
  }, [restoreBackgroundBuild, resumePendingBackgroundBuild]);

  // After a force-quit, hydrate the pending build from disk and resume polling.
  useEffect(() => {
    void resumePendingBackgroundBuild();
  }, [resumePendingBackgroundBuild]);

  // Tab refocus: same hydration path when Coach was already mounted in the tab bar.
  useFocusEffect(
    useCallback(() => {
      void resumePendingBackgroundBuild();
      void (async () => {
        await hydrateSlatePreAnalysisCache();
        await hydrateCoachSlateFromServer();
        startSlatePreAnalysis("coach-focus");
      })();
      if (streamingRef.current || buildFinishingRef.current || waiting) return;
      const partial = latestBoardScanRef.current;
      if (partial && boardScanIsComplete(partial)) {
        if (partial.picks?.length) {
          deliverBoardScanTicket(partial);
        } else {
          patchInstantBoardScanTicket(partial);
        }
        return;
      }
      setMessages((prev) => {
        if (!isOrphanCoachThread(prev, { streaming: false, buildFinishing: false })) return prev;
        return recoverOrphanCoachThread(prev);
      });
    }, [
      resumePendingBackgroundBuild,
      deliverBoardScanTicket,
      patchInstantBoardScanTicket,
      waiting,
    ]),
  );

  // While a build is handed off, poll the server stash on a timer so the result
  // replays the moment it's ready — and, if it never arrives, the wait-timeout in
  // decideBackgroundRestore turns it into a "couldn't finish — try again" recovery
  // instead of an endless "still building". Covers the case where the user just
  // sits on the screen and never re-foregrounds the app. Cleared once the build
  // resolves (replay/failed clear bgWatchId) or a new stream starts.
  useEffect(() => {
    if (!bgWatchId) return;
    const poll = () => {
      if (streamingRef.current) return;
      const pend = pendingBgRef.current;
      if (pend) {
        void restoreBackgroundBuild(pend.buildId, { auto: true });
      } else {
        void resumePendingBackgroundBuild();
      }
    };
    void poll();
    const id = setInterval(poll, PENDING_POLL_MS);
    return () => clearInterval(id);
  }, [bgWatchId, restoreBackgroundBuild, resumePendingBackgroundBuild]);

  // Tapping the "your ticket is ready" push opens Coach with ?buildId=… — load
  // and replay that finished build. restoredBuildRef guards against re-running.
  useEffect(() => {
    const bid = params.buildId ? String(params.buildId) : "";
    if (!bid) return;
    pendingBgRef.current = { buildId: bid };
    void restoreBackgroundBuild(bid);
  }, [params.buildId, restoreBackgroundBuild]);

  // Auto-send when navigated with send=1 (e.g. Home "Build best parlay" / quick
  // chips). Gated by the per-navigation `ts` token (not the prompt text) so that
  // tapping different actions that happen to share a prompt still fires each
  // time, and so the same tab staying mounted doesn't suppress later taps. We
  // mark sent only once we actually invoke send, and skip while streaming — the
  // effect re-runs when `streaming` flips false, so the send isn't lost.
  useEffect(() => {
    const sendFlag = Array.isArray(params.send) ? params.send[0] : params.send;
    const autoMsgRaw = params.autoMsg ?? (sendFlag === "1" ? params.prefill : null);
    const autoMsg = Array.isArray(autoMsgRaw) ? autoMsgRaw[0] : autoMsgRaw;
    if (sendFlag !== "1" || !autoMsg) return;
    const launch = takeCoachLaunch();
    const token = String(params.ts ?? autoMsg);
    if (autoSentRef.current === token) return;
    if (streaming && !launch?.freshThread && !isParlayBuildAsk(String(autoMsg))) return;
    if (buildFinishing && !launch?.freshThread && !isParlayBuildAsk(String(autoMsg))) return;
    autoSentRef.current = token;
    send(String(autoMsg), {
      hideUserBubble: launch?.hideBubble ?? !!params.autoMsg,
      freshThread: launch?.freshThread ?? false,
    });
  }, [params.send, params.ts, params.autoMsg, params.prefill, streaming, buildFinishing, send]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      simAbortRef.current?.abort();
    };
  }, []);

  const headerUserTexts = useMemo(
    () => messages.filter((m) => m.role === "user").map((m) => m.content),
    [messages],
  );
  const headerSlateLabel = useMemo(() => {
    const last = headerUserTexts.at(-1) ?? "";
    const day = slateDayFromThread(last, headerUserTexts.slice(0, -1));
    return slateOddsLabel(day ?? "tonight");
  }, [headerUserTexts]);

  // Older OTAs injected dead watchdog prose into assistant bubbles — scrub on load.
  useEffect(() => {
    setMessages((prev) => pruneDeadParlayPlaceholders(scrubDeadBuildProseFromMessages(prev)));
  }, []);

  // Legacy OTA watchdog prose can survive in React state — scrub once build is idle.
  useEffect(() => {
    if (streaming || buildFinishing || waiting) return;
    const last = messages[messages.length - 1];
    if (last?.role !== "assistant" || !DEAD_BUILD_PROSE_RE.test(last.content ?? "")) return;
    setMessages((prev) => pruneDeadParlayPlaceholders(scrubDeadBuildProseFromMessages(prev)));
  }, [messages, streaming, buildFinishing, waiting]);

  const footerParlayProgress = useMemo(() => {
    const last = messages[messages.length - 1];
    if (last?.picks?.length) return false;
    const buildIdle = !buildFinishing && !streaming && !waiting;
    if (buildIdle) return false;
    if (!(buildFinishing || streaming || buildProgressExpired)) return false;
    let parlayUserText = "";
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "user") continue;
      const text = m.apiContent ?? m.content;
      if (isParlayBuildAsk(text)) {
        parlayUserText = text;
        break;
      }
    }
    if (!parlayUserText) return false;
    const target =
      last?.ticketLegTarget ?? requestedLegCount(parlayUserText);
    if (last?.picks?.length && target > 0 && last.picks.length < target) {
      return !buildIdle;
    }
    // When the newest message is the user's parlay ask, show progress even if the
    // assistant placeholder was lost to a superseded-send race.
    return last?.role === "user";
  }, [messages, buildFinishing, streaming, buildProgressExpired]);

  const footerProgressLegCount = Math.max(
    boardScanPartialLegs,
    boardTicketSnapshotRef.current?.length ?? 0,
    latestBoardScanRef.current?.picks?.length ?? 0,
  );

  const showQuickPrompts =
    !messages.some((m) => m.role === "user") ||
    isOrphanCoachThread(messages, { streaming, buildFinishing });

  const hasUserTurn = messages.some((m) => m.role === "user");
  /** Busy spinners only when a build is actually in flight — not on the welcome screen. */
  const coachBuildInFlight =
    hasUserTurn && (streaming || buildFinishing || waiting || boardScanAwaiting);

  // Recover stale busy flags left after a superseded send or OTA reload — welcome
  // with spinners on every quick prompt means streaming stuck true with no thread.
  useEffect(() => {
    if (hasUserTurn) return;
    if (!streaming && !buildFinishing && !waiting) return;
    setStreaming(false);
    setBuildFinishing(false);
    setWaiting(false);
    setBuildProgressExpired(false);
    setParlayBuildPhase("idle");
    clearBuildStallWatchdog();
  }, [hasUserTurn, streaming, buildFinishing, waiting, clearBuildStallWatchdog]);

  // Finished empty-scan tickets can leave build flags set while the manifest is
  // already on screen — unlock the composer so the user can type a new ask.
  useEffect(() => {
    if (!hasUserTurn || (!streaming && !buildFinishing && !waiting)) return;
    const last = messages[messages.length - 1];
    if (last?.role !== "assistant") return;
    if (!coachReplyHasScanManifest(undefined, last.coachDetailNote)) return;
    const scan = latestBoardScanRef.current;
    if (!scan || !boardScanIsComplete(scan)) return;
    setStreaming(false);
    setBuildFinishing(false);
    setWaiting(false);
    setBuildProgressExpired(false);
    setParlayBuildPhase("idle");
    setCoachBuildBusy(false);
    clearBuildStallWatchdog();
  }, [
    hasUserTurn,
    messages,
    streaming,
    buildFinishing,
    waiting,
    clearBuildStallWatchdog,
  ]);

  // Keep trying board-scan delivery while the build is in flight or picks are stashed.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role !== "assistant" || (last.picks?.length ?? 0) > 0) return;
    const staleDeadEnd = STALE_PARLAY_DEAD_END_RE.test(last.content ?? "");
    if (staleDeadEnd) {
      setMessages((prev) => scrubDeadBuildProseFromMessages(prev));
    }
    const priorUser = [...messages].reverse().find((m) => m.role === "user");
    const parlayIntent = !!last.parlayBuild || isParlayBuildAsk(priorUser?.content ?? "");
    if (!parlayIntent) return;

    const partial = latestBoardScanRef.current;
    if (emptyScanTerminalFiredRef.current) return;
    const exhaustedEmpty = !!partial?.scanComplete && !(partial.picks?.length);
    if (exhaustedEmpty) return;

    const undeliveredScanLegs =
      boardScanPartialLegs > 0 || (partial?.picks?.length ?? 0) > 0;
    const buildActive = streaming || buildFinishing || waiting || boardScanAwaiting;
    if (!buildActive && !undeliveredScanLegs && !staleDeadEnd) return;

    const tryDeliver = (): boolean => {
      const cur = messagesRef.current[messagesRef.current.length - 1];
      if (cur?.picks?.length) return true;
      return deliverPendingBoardScanIfReady();
    };

    if (tryDeliver()) return;

    let attempts = 0;
    const interval = setInterval(() => {
      if (emptyScanTerminalFiredRef.current) {
        clearInterval(interval);
        return;
      }
      attempts += 1;
      if (attempts > 60) {
        clearInterval(interval);
        return;
      }
      if (messagesRef.current[messagesRef.current.length - 1]?.picks?.length) {
        clearInterval(interval);
        return;
      }
      if (tryDeliver()) clearInterval(interval);
    }, 500);
    return () => clearInterval(interval);
  }, [
    messages,
    streaming,
    buildFinishing,
    waiting,
    boardScanAwaiting,
    boardScanPartialLegs,
    deliverPendingBoardScanIfReady,
  ]);

  // Silent dead-end: parlay build finished with no pick cards (blank or generic fallback).
  useEffect(() => {
    if (streaming || buildFinishing || waiting || boardScanAwaiting) return;
    const last = messages[messages.length - 1];
    if (last?.role !== "assistant" || (last.picks?.length ?? 0) > 0) return;
    if (coachReplyHasScanManifest(undefined, last.coachDetailNote)) return;
    const priorUser = [...messages].reverse().find((m) => m.role === "user");
    const parlayIntent = !!last.parlayBuild || isParlayBuildAsk(priorUser?.content ?? "");
    if (!parlayIntent) return;
    const content = (last.content ?? "").trim();
    const genericFailure =
      /couldn't ground a real ticket/i.test(content) ||
      /couldn't ground any of those legs/i.test(content);
    const staleDeadEnd = STALE_PARLAY_DEAD_END_RE.test(content);
    if (content && !genericFailure && !staleDeadEnd) return;
    if (staleDeadEnd) {
      setMessages((prev) => scrubDeadBuildProseFromMessages(prev));
    }

    const tryStashedDelivery = () => {
      if (deliverPendingBoardScanIfReady()) return true;
      const legTarget =
        requestedLegCount(priorUser?.content ?? "") ||
        effectiveBuildLegCount(priorUser?.content ?? "");
      const seed = readSlatePreAnalysisSeed(
        legTarget > 0 ? { legs: legTarget } : undefined,
      );
      if (seed?.boardScan?.picks?.length) {
        if (legTarget > 0 && !boardScanMatchesLegTarget(seed.boardScan, legTarget)) {
          return false;
        }
        const enrich = coachFlashEnrichFromBuilt(seed.built, { perfByFamily: marketPerf });
        return patchInstantBoardScanTicket(markBoardScanAsPreview(seed.boardScan), enrich, {
          legNote: COACH_SLATE_PREVIEW_NOTE,
          ticketLegTarget: legTarget > 0 ? legTarget : undefined,
        });
      }
      return tryInstantSlateSeedDelivery(legTarget);
    };

    if (tryStashedDelivery()) return;

    const retryText = priorUser?.content?.trim();
    if (retryText) {
      const partial = latestBoardScanRef.current;
      const stillScanning =
        boardScanInFlightRef.current ||
        boardScanAwaiting ||
        (!!partial && !boardScanIsComplete(partial));
      if (stillScanning) return;
      const exhaustedEmpty = !!partial?.scanComplete && !(partial.picks?.length);
      if (!exhaustedEmpty && !partial?.scanComplete) return;
      if (exhaustedEmpty) {
        const legTarget =
          requestedLegCount(retryText) || effectiveBuildLegCount(retryText);
        const emptyReason = emptyReasonForScan(partial!);
        setBuildProgressExpired(false);
        setBoardScanAwaiting(false);
        setParlayBuildPhase("idle");
        setBoardScanLiveProgress(deriveBoardScanLiveProgress(partial!, emptyReason));
        logCoachPickDiag("dead-end", {
          legTarget,
          stillScanning,
          exhaustedEmpty: true,
          partialPicks: 0,
          totalScanned: partial?.totalScanned ?? 0,
          totalQualified: partial?.totalQualified ?? 0,
          emptyReason,
        });
        setMessages((prev) => {
          const copy = [...prev];
          const idx = copy.length - 1;
          if (copy[idx]?.role !== "assistant") return prev;
          if (copy[idx]?.picks?.length) return prev;
          copy[idx] = {
            ...copy[idx],
            content: COACH_EMPTY_BOARD_SCAN_LEAD,
            legNote: emptyReason,
            coachDetailNote:
              copy[idx].coachDetailNote ||
              coachBoardScanManifestForMessage(partial!, flashEnrichRef.current, legTarget),
            retry: undefined,
          };
          return copy;
        });
        return;
      }

      logCoachPickDiag("dead-end", {
        legTarget: requestedLegCount(retryText) || effectiveBuildLegCount(retryText),
        stillScanning,
        exhaustedEmpty: false,
        partialPicks: partial?.picks.length ?? 0,
        totalScanned: partial?.totalScanned ?? 0,
        totalQualified: partial?.totalQualified ?? 0,
      });
      return;
    }

    let attempts = 0;
    const interval = setInterval(() => {
      if (emptyScanTerminalFiredRef.current) {
        clearInterval(interval);
        return;
      }
      const livePartial = latestBoardScanRef.current;
      if (livePartial?.scanComplete && !livePartial.picks?.length) {
        clearInterval(interval);
        return;
      }
      attempts += 1;
      if (attempts > 20) {
        clearInterval(interval);
        return;
      }
      if (streamingRef.current || buildFinishingRef.current || waiting || boardScanAwaiting) {
        clearInterval(interval);
        return;
      }
      if (tryStashedDelivery()) clearInterval(interval);
    }, 2000);
    return () => clearInterval(interval);
  }, [messages, streaming, buildFinishing, waiting, boardScanAwaiting, deliverPendingBoardScanIfReady, patchInstantBoardScanTicket, tryInstantSlateSeedDelivery, marketPerf]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ paddingTop: insets.top + 8, paddingLeft: 64, paddingRight: 16, paddingBottom: 12 }}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 24 }}>
          AI Coach
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, marginTop: 2 }}>
          Picks grounded in {headerSlateLabel} real odds — never invented
        </Text>
      </View>

      <KeyboardAwareScrollViewCompat
        ref={scrollRef as any}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 + slipClearance }}
        bottomOffset={12}
        onScroll={onCoachScroll}
        scrollEventThrottle={16}
      >
        <View style={{ gap: 14, paddingTop: 4 }}>
          {messages
            .map((m, i) => ({ m, i }))
            .filter(
              ({ m }) =>
                !(isWelcomeMessage(m) && messages.some((x) => x.role === "user")),
            )
            .map(({ m, i }) => {
            const hasPicks = !!(m.picks && m.picks.length > 0);
            const displayPicks = hasPicks
              ? filterCoachDeliveredPicks(
                  coerceCoachDisplayPicks(m.picks!, flashEnrichRef.current),
                  flashEnrichRef.current,
                )
              : [];
            const showTicketPicks = displayPicks.length > 0;
            const hasScanManifest = /### Scan manifest/i.test(m.coachDetailNote ?? "");
            const showTicketHeader = showTicketPicks || hasScanManifest;
            const isWaiting = m.role === "assistant" && m.content === "" && waiting;
            // A parlay still mid-stream: PICK lines have arrived in the raw text
            // but haven't been parsed into cards yet. Show a "Building…" hint
            // instead of leaving the user staring at stripped/empty text.
            // A parlay BUILD is in flight when either the user explicitly asked to
            // build one (catches the early stream BEFORE any PICK line, so the
            // lead-in prose never flashes) or PICK lines have started arriving.
            const priorUserText =
              messages
                .slice(0, i)
                .reverse()
                .find((x) => x.role === "user")
                ?.apiContent ??
              messages.slice(0, i).reverse().find((x) => x.role === "user")?.content ??
              "";
            const parlayBuildIntent =
              m.role === "assistant" && !!(m.parlayBuild || isParlayBuildAsk(priorUserText));
            const ticketLegTarget =
              m.ticketLegTarget ?? (parlayBuildIntent ? requestedLegCount(priorUserText) : 0);
            const picksShortOfTarget =
              showTicketPicks && ticketLegTarget > 0 && displayPicks.length < ticketLegTarget;
            const buildIdle = !buildFinishing && !streaming && !waiting && !boardScanAwaiting;
            const parlayScanInProgress =
              i === messages.length - 1 &&
              parlayBuildIntent &&
              (boardScanAwaiting ||
                picksShortOfTarget ||
                parlayBuildPhase === "board-scan") &&
              !buildIdle;
            const staleDeadEndProse =
              m.role === "assistant" && STALE_PARLAY_DEAD_END_RE.test(m.content ?? "");
            const deadBuildProse =
              m.role === "assistant" &&
              (DEAD_BUILD_PROSE_RE.test(m.content) || staleDeadEndProse);
            const isBuildingParlay =
              m.role === "assistant" &&
              streaming &&
              !buildProgressExpired &&
              i === messages.length - 1 &&
              !hasPicks &&
              (parlayBuildIntent ||
                m.content.split("\n").some((l) => PICK_SCAFFOLD_RE.test(l.trim())));
            const scanLegProgress = Math.max(
              boardScanPartialLegs,
              boardTicketSnapshotRef.current?.length ?? 0,
              latestBoardScanRef.current?.picks?.length ?? 0,
            );
            const parlayAwaitingDelivery =
              m.role === "assistant" &&
              i === messages.length - 1 &&
              !hasPicks &&
              parlayBuildIntent &&
              !boardScanAwaiting &&
              !streaming &&
              !buildFinishing &&
              !waiting &&
              scanLegProgress > 0;
            const parlayStillBuilding =
              m.role === "assistant" &&
              i === messages.length - 1 &&
              !hasPicks &&
              (boardScanAwaiting ||
                buildFinishing ||
                streaming ||
                parlayBuildPhase === "board-scan" ||
                parlayAwaitingDelivery ||
                (buildProgressExpired &&
                  parlayBuildPhase !== "board-scan" &&
                  parlayBuildPhase !== "stream") ||
                deadBuildProse) &&
              (parlayBuildIntent || deadBuildProse);
            const parlayStillFilling =
              m.role === "assistant" &&
              i === messages.length - 1 &&
              parlayScanInProgress;
            const parlayStalledEmpty =
              m.role === "assistant" &&
              i === messages.length - 1 &&
              !hasPicks &&
              parlayBuildIntent &&
              !boardScanAwaiting &&
              !streaming &&
              !buildFinishing &&
              !waiting &&
              !m.content.trim();
            const parlayBuildHung =
              m.role === "assistant" &&
              i === messages.length - 1 &&
              !hasPicks &&
              parlayBuildIntent &&
              !boardScanAwaiting &&
              buildProgressExpired &&
              !streaming &&
              !buildFinishing &&
              !waiting &&
              !m.retry;
            const parlayStuckDeadProse =
              m.role === "assistant" &&
              i === messages.length - 1 &&
              !hasPicks &&
              deadBuildProse &&
              !streaming &&
              !buildFinishing &&
              !waiting;
            const retryAffordance =
              !!m.retry &&
              !boardScanAwaiting &&
              parlayBuildPhase !== "board-scan" &&
              (parlayBuildIntent || !assistantHasVisibleContent(m));
            const boardScanExhaustedEmpty =
              i === messages.length - 1 &&
              (boardScanLiveProgress?.exhaustedEmpty ||
                (!!latestBoardScanRef.current?.scanComplete &&
                  !(latestBoardScanRef.current?.picks?.length ?? 0)));
            const emptyScanTerminalMessage =
              m.role === "assistant" &&
              /Full board scan finished — no legs cleared delivery gates/i.test(m.content ?? "");
            const parlayShowRetryButton =
              i === messages.length - 1 &&
              !hasPicks &&
              !coachBuildInFlight &&
              !parlayStillBuilding &&
              !isBuildingParlay &&
              !boardScanAwaiting &&
              !parlayAwaitingDelivery &&
              !boardScanExhaustedEmpty &&
              parlayBuildPhase !== "board-scan" &&
              (parlayStuckDeadProse || retryAffordance) &&
              !(staleDeadEndProse && scanLegProgress > 0);
            // Progress finalizes once pick cards are on the message — or when a
            // board-scan partial has scored legs waiting for delivery gates.
            const progressLegCount = showTicketPicks
              ? displayPicks.length
              : parlayAwaitingDelivery || !buildIdle
                ? scanLegProgress
                : 0;
            // An "analyze my ticket" reply is in its waiting phase (request sent,
            // nothing streamed back yet). It carries the scanned legs (analyzeSlip)
            // so we can show the rich step-by-step AnalysisProgress instead of a
            // plain spinner — the analysis text replaces it the moment it arrives.
            const analyzeWaiting = isWaiting && !!m.analyzeSlip?.length;
            // A plain question (not a parlay build, not a ticket analysis) in its
            // waiting phase. Show the same rich step-by-step AnalysisProgress card
            // (generic, honest "ask" copy) instead of the small rotating pill so
            // every question gets the analyzing box.
            const askWaiting = isWaiting && !isBuildingParlay && !analyzeWaiting && !parlayBuildIntent;
            const ticketActive = showTicketHeader;
            const bubbleText =
              m.role === "assistant"
                ? ticketActive
                  ? ""
                  : assistantBubbleText(m.content, ticketActive)
                : m.content;
            // Parlay tickets lead with pick cards; legNote explains honest shortfalls.
            const showBubble =
              !ticketActive &&
              !m.hideBubble &&
              !m.statCard &&
              !m.periodGameLog &&
              !m.teamCard &&
              !isBuildingParlay &&
              !parlayStillBuilding &&
              !boardScanAwaiting &&
              !parlayStalledEmpty &&
              !deadBuildProse &&
              !analyzeWaiting &&
              !askWaiting &&
              (bubbleText.length > 0 || !!m.imageUris?.length);
            return (
              <View key={i}>
                {m.analyzeSlip?.length ? (
                  <View style={{ marginBottom: showBubble || isWaiting ? 10 : 0 }}>
                    <TicketScanSummary legs={m.analyzeSlip} loading={isWaiting} />
                  </View>
                ) : null}
                {m.statCard ? (
                  <View style={{ gap: 10, marginBottom: m.content?.trim() ? 4 : 0 }}>
                    <PlayerStatCard data={m.statCard} />
                    {m.content?.trim() ? (
                      <View
                        style={{
                          alignSelf: "flex-start",
                          maxWidth: "88%",
                          backgroundColor: colors.card,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: 16,
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                        }}
                      >
                        <ChatMarkdown
                          text={assistantBubbleText(m.content, false)}
                          color={colors.foreground}
                          mutedColor={colors.mutedForeground}
                        />
                      </View>
                    ) : null}
                  </View>
                ) : m.periodGameLog ? (
                  <PeriodGameLogCard data={m.periodGameLog} />
                ) : m.teamCard ? (
                  <TeamStatCard data={m.teamCard} />
                ) : showBubble ? (
                  <Pressable
                    onLongPress={isWaiting ? undefined : () => copyMessage(bubbleText)}
                    delayLongPress={300}
                    style={{
                      alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                      maxWidth: "88%",
                      backgroundColor: m.role === "user" ? colors.primary : colors.card,
                      borderWidth: m.role === "user" ? 0 : 1,
                      borderColor: colors.border,
                      borderRadius: 16,
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                    }}
                  >
                    {m.imageUris?.length ? (
                      <View
                        style={{
                          flexDirection: "row",
                          flexWrap: "wrap",
                          gap: 6,
                          marginBottom: bubbleText.length > 0 ? 8 : 0,
                        }}
                      >
                        {m.imageUris.map((uri, idx) => (
                          <Image
                            key={`${uri}-${idx}`}
                            source={{ uri }}
                            style={{
                              width: m.imageUris!.length === 1 ? 200 : 120,
                              height: m.imageUris!.length === 1 ? 200 : 120,
                              borderRadius: 10,
                            }}
                            contentFit="cover"
                          />
                        ))}
                      </View>
                    ) : null}
                    {bubbleText.length > 0 ? (
                      m.role === "assistant" ? (
                        <ChatMarkdown
                          text={bubbleText}
                          color={colors.foreground}
                          mutedColor={colors.mutedForeground}
                        />
                      ) : (
                        <Text
                          selectable
                          style={{
                            color: colors.primaryForeground,
                            fontFamily: FONT.body,
                            fontSize: 14,
                            lineHeight: 21,
                          }}
                        >
                          {bubbleText}
                        </Text>
                      )
                    ) : null}
                  </Pressable>
                ) : null}

                {/* Step-by-step AI progress: shown while a parlay BUILDS (grounded
                    in the live leg count so it finalizes when real picks stream)
                    or while an "analyze my ticket" request is WAITING. */}
                {((isBuildingParlay || parlayStillFilling || parlayStillBuilding || boardScanAwaiting || parlayAwaitingDelivery) &&
                  !showTicketPicks &&
                  !hasPicks &&
                  !emptyScanTerminalMessage) ? (
                  <AnalysisProgress
                    mode="build"
                    legCount={progressLegCount}
                    buildPhase={parlayBuildPhase === "idle" ? undefined : parlayBuildPhase}
                    boardScanProgress={activeBoardScanProgress}
                  />
                ) : analyzeWaiting ? (
                  <AnalysisProgress mode="analyze" />
                ) : askWaiting ? (
                  <AnalysisProgress mode="ask" />
                ) : null}

                {showTicketHeader ? (
                  <View style={{ gap: 8, marginTop: 10 }}>
                    {showTicketPicks || hasScanManifest ? (
                      <CoachTicketHeader
                        picks={displayPicks}
                        legNote={m.legNote}
                        coachDetailNote={m.coachDetailNote}
                        requestedLegs={ticketLegTarget > 0 ? ticketLegTarget : undefined}
                        scanInProgress={parlayScanInProgress}
                      />
                    ) : null}
                    {displayPicks.length > 1 ? (
                      <AddAllButton
                        picks={displayPicks}
                        slipCount={legs.length}
                        addLeg={addLeg}
                        removeLeg={removeLeg}
                        hasLeg={hasLeg}
                      />
                    ) : null}
                    {displayPicks.map((p, j) => (
                      <PickCard
                        key={`${i}-${j}`}
                        pick={p}
                        onPress={statsHandlerFor(p)}
                        badge={
                          pickShowsAltBadge(p)
                            ? {
                                text: "ALT PICK",
                                caption: "Alternate rung — positive EV, edge, and sim grade",
                                tone: "grade" as const,
                              }
                            : p.finalAiScore?.simAligned &&
                                (p.finalAiScore.recommends || p.ticketRole === "alt")
                              ? {
                                  text: "Sim-Aligned",
                                  caption: `10k sim ${p.finalAiScore.simHit != null ? `${Math.round(p.finalAiScore.simHit * 100)}%` : ""} hit`,
                                  tone: "grade" as const,
                                }
                              : null
                        }
                      />
                    ))}
                    {m.backupPicks && m.backupPicks.length > 0 ? (
                      <View style={{ gap: 8, marginTop: 12 }}>
                        <Text
                          style={{
                            color: colors.mutedForeground,
                            fontFamily: FONT.semibold,
                            fontSize: 13,
                          }}
                        >
                          Alt lines — positive edge
                        </Text>
                        {m.backupPicks.map((p, j) => (
                          <PickCard
                            key={`${i}-backup-${j}`}
                            pick={p}
                            onPress={statsHandlerFor(p)}
                            badge={{
                              text: "Alt line",
                              caption:
                                (p as ParsedPick & { backupReason?: string }).backupReason ??
                                "Passed 10k sim grading",
                              tone: "grade" as const,
                            }}
                          />
                        ))}
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {parlayShowRetryButton ? (
                  <Pressable
                    onPress={() => {
                      abortRef.current?.abort();
                      simAbortRef.current?.abort();
                      setBuildFinishing(false);
                      setStreaming(false);
                      setWaiting(false);
                      setBuildProgressExpired(false);
                      setParlayBuildPhase("idle");
                      send(
                        m.retry ||
                          activeParlayAskRef.current ||
                          priorUserText ||
                          trimmed ||
                          "Build me a 15-leg longshot parlay",
                        { freshThread: true },
                      );
                    }}
                    disabled={false}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      marginTop: 10,
                      backgroundColor: colors.card,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                      paddingVertical: 12,
                      paddingHorizontal: 14,
                      opacity: pressed ? 0.85 : 1,
                    })}
                  >
                    <Feather name="refresh-cw" size={16} color={colors.foreground} />
                    <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
                      Try again
                    </Text>
                  </Pressable>
                ) : null}

                {parlayShowRetryButton && !coachBuildInFlight ? (
                  <Pressable
                    onPress={() => {
                      composerInputRef.current?.focus();
                      scrollToEnd(true);
                    }}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      marginTop: 8,
                      paddingVertical: 10,
                      opacity: pressed ? 0.85 : 1,
                    })}
                  >
                    <Feather name="edit-3" size={15} color={colors.primary} />
                    <Text style={{ color: colors.primary, fontFamily: FONT.semibold, fontSize: 13 }}>
                      Or type a new ask in the box below
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}

          {footerParlayProgress ? (
            <AnalysisProgress
              mode="build"
              legCount={footerProgressLegCount}
              buildPhase={parlayBuildPhase === "idle" ? undefined : parlayBuildPhase}
            />
          ) : null}

          {showQuickPrompts ? (
            <View style={{ gap: 8, marginTop: 4 }}>
              {QUICK_PROMPTS.map((q) => (
                <Pressable
                  key={q.label}
                  onPress={() => send(q.prompt, { freshThread: true, userBubble: q.label })}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                    padding: 14,
                    opacity: coachBuildInFlight ? 0.7 : pressed ? 0.85 : 1,
                  })}
                >
                  <Feather name="zap" size={16} color={colors.accent} />
                  <Text style={{ color: colors.foreground, fontFamily: FONT.medium, fontSize: 14, flex: 1 }}>
                    {q.label}
                  </Text>
                  {coachBuildInFlight ? (
                    <ActivityIndicator color={colors.mutedForeground} size="small" />
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}
          </View>
      </KeyboardAwareScrollViewCompat>

      {/* Transient "copied" confirmation after a long-press copy. */}
      {copied ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            bottom: insets.bottom + 96,
            alignSelf: "center",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            backgroundColor: colors.foreground,
            borderRadius: 999,
            paddingHorizontal: 14,
            paddingVertical: 8,
          }}
        >
          <Feather name="check" size={14} color={colors.background} />
          <Text style={{ color: colors.background, fontFamily: FONT.medium, fontSize: 13 }}>
            Copied
          </Text>
        </View>
      ) : null}

      {/* Composer — pinned at bottom; flexShrink keeps it in the viewport */}
      <View style={{ flexShrink: 0 }}>
      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
      {/* Keyboard-dismiss button — only while the keyboard is open */}
      {inputFocused ? (
        <View style={{ alignItems: "flex-end", paddingHorizontal: 16, paddingBottom: 8 }}>
          <Pressable
            onPress={() => Keyboard.dismiss()}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Feather name="chevron-down" size={22} color={colors.mutedForeground} />
          </Pressable>
        </View>
      ) : null}
      {/* Attached-photo previews — up to 3, shown above the input until sent or removed. */}
      {attachedImages.length ? (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 12,
            paddingHorizontal: 16,
            paddingBottom: 8,
          }}
        >
          {attachedImages.map((img, idx) => (
            <View key={`${img.uri}-${idx}`} style={{ alignSelf: "flex-start" }}>
              <Image
                source={{ uri: img.uri }}
                style={{
                  width: 84,
                  height: 84,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
                contentFit="cover"
              />
              <Pressable
                onPress={() => setAttachedImages((prev) => prev.filter((_, i) => i !== idx))}
                hitSlop={8}
                style={{
                  position: "absolute",
                  top: -8,
                  right: -8,
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: colors.foreground,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Feather name="x" size={14} color={colors.background} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 8,
          paddingHorizontal: 16,
          paddingTop: 10,
          paddingBottom: insets.bottom + 10,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.background,
        }}
      >
        <Pressable
          onPress={pickImage}
          disabled={coachBuildInFlight || pickingImage || attachedImages.length >= MAX_IMAGES}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
            justifyContent: "center",
            opacity:
              pressed || coachBuildInFlight || attachedImages.length >= MAX_IMAGES ? 0.6 : 1,
          })}
        >
          {pickingImage ? (
            <ActivityIndicator color={colors.mutedForeground} size="small" />
          ) : (
            <Feather name="image" size={20} color={colors.mutedForeground} />
          )}
        </Pressable>
        <TextInput
          ref={composerInputRef}
          value={input}
          onChangeText={setInput}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          placeholder="Ask for a parlay, value bet, matchup…"
          placeholderTextColor={colors.mutedForeground}
          multiline
          style={{
            flex: 1,
            color: colors.foreground,
            fontFamily: FONT.body,
            fontSize: 14,
            maxHeight: 120,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 18,
            paddingHorizontal: 14,
            paddingTop: 10,
            paddingBottom: 10,
          }}
        />
        <Pressable
          onPress={() => send(input)}
          disabled={
            (!input.trim() && !attachedImages.length) ||
            (coachBuildInFlight && !isParlayBuildAsk(input.trim()))
          }
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor:
              (!input.trim() && !attachedImages.length) ||
              (coachBuildInFlight && !isParlayBuildAsk(input.trim()))
                ? colors.card
                : colors.primary,
            borderWidth:
              (!input.trim() && !attachedImages.length) ||
              (coachBuildInFlight && !isParlayBuildAsk(input.trim()))
                ? 1
                : 0,
            borderColor: colors.border,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.85 : 1,
          })}
        >
          {coachBuildInFlight && !isParlayBuildAsk(input.trim()) ? (
            <ActivityIndicator color={colors.mutedForeground} size="small" />
          ) : (
            <Feather
              name="arrow-up"
              size={20}
              color={
                !input.trim() && !attachedImages.length ? colors.mutedForeground : colors.primaryForeground
              }
            />
          )}
        </Pressable>
      </View>
      <Text
        style={{
          paddingHorizontal: 16,
          paddingTop: 4,
          paddingBottom: 6,
          color: colors.mutedForeground,
          fontFamily: FONT.body,
          fontSize: 10,
          textAlign: "center",
        }}
      >
        OTA {otaCommitLabel}
      </Text>
      </KeyboardStickyView>
      </View>
    </View>
  );
}
