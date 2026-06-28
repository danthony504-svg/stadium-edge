import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Keyboard,
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
import { attachPickScores } from "@/lib/pickScoreContext";
import { enforceMlLeanOnPicks, mlLeanEnforcementNote } from "@/lib/mlLeanEnforcement";
import {
  confidenceSatisfiesThreshold,
  confidenceScoreFromSignals,
  describeConfidenceThreshold,
  parseConfidenceThreshold,
} from "@/lib/confidence";
import { parseOddsThreshold, oddsSatisfiesThreshold, wantsPeriodMarkets } from "@/lib/format";
import { FONT } from "@/components/ui";
import { AnalysisProgress } from "@/components/AnalysisProgress";
import { useCoachSlipClearance } from "@/components/SlipBar";
import { useBetSlip, MAX_LEGS } from "@/context/BetSlipContext";
import { useColors } from "@/hooks/useColors";
import { computeAnalytics, computeModelStrengths } from "@/lib/modelReport";
import { perfMapFromByFamily } from "@/lib/marketWeighting";
import { stripTrailingReminder } from "@/lib/reminderStrip";
import { focalSportsFromText } from "@/lib/chatContextPriority";
import {
  buildChatContext,
  gameMatchesFocalText,
  getPlayerHistory,
  getStatmuseGamelog,
  getTeamHistory,
  getSync,
  propPoolFromRealProps,
  searchPlayer,
  searchTeam,
  startsTodayUpcoming,
  todayBuildNote,
  mentionsPropIntent,
  wantsPropsOnly,
  wantsTodayOnly,
  explicitSingleGameIntent,
  streamChat,
  chatStreamFailureMessage,
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
import { NAME_FALLBACK_SKIP, parseStatLookup, isCoachRecommendationQuestion } from "@/lib/statLookup";
import {
  decideBackgroundRestore,
  deserializePendingBuild,
  makeBuildId,
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
// stall and offering a retry (instead of an endless "still building"). Sized
// well past a real build's worst case so a genuinely in-flight server build is
// never cut off. The poll re-checks the stash at PENDING_POLL_MS while we wait.
const PENDING_BUILD_MAX_WAIT_MS = 120_000;
const PENDING_POLL_MS = 10_000;

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
      periodRequested: lookup.period,
    },
  };
}

const QUICK_PROMPTS: { label: string; prompt: string }[] = [
  { label: "3-Leg parlay", prompt: "Build me a 3-leg parlay for tonight" },
  { label: "6-Leg parlay", prompt: "Build me a 6-leg parlay for tonight" },
  { label: "9-Leg parlay", prompt: "Build me a 9-leg parlay for tonight" },
  { label: "15-Leg longshot", prompt: "Build me a 15-leg longshot parlay for tonight" },
  { label: "Player props only", prompt: "Build me a player props only parlay for tonight" },
];

const CHAT_SEEN_KEY = "se_chat_seen";

const WELCOME_FIRST_TIME =
  "Welcome to Stadium Edge. I’m connected to live odds, live game data, and an AI brain built for sports analysis. Toggle PICK LIVE to load real-time matchups, then ask me anything — I factor in odds value, team form, coaching tendencies, injuries, and weather conditions to give you the sharpest possible take.\n\nTap 3-Leg, 6-Leg, 9-Leg, or 15-Leg to build a parlay that size, or just type what you want. Heads up: confidence compounds down with each leg — a 15-leg parlay is a true longshot.";

const WELCOME_RETURNING =
  "Stadium Edge is locked in. Tap 3-Leg, 6-Leg, 9-Leg, or 15-Leg — or just tell me what you want. Let’s build.";

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

// assistantBubbleText also strips the model's trailing responsible-gambling
// sign-off (see lib/reminderStrip) so it doesn't render as a dangling line.
function assistantBubbleText(content: string, hasPicks: boolean): string {
  if (hasPicks) return "";
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
  /\b(?:will|would|can|could)\s+(?!you\b)[a-z.'’\- ]{2,30}?\s(?:score|get|have|put up|go for|drop|record|tally|hit|reach|exceed)\b/i;

function isProjectionQuestion(text: string): boolean {
  return PROJECTION_RE.test(text) || PROJECTION_WILL_RE.test(text);
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
  const slipClearance = useCoachSlipClearance();
  const router = useRouter();
  const params = useLocalSearchParams<{ prefill?: string; send?: string; ts?: string; buildId?: string }>();
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
  const [input, setInput] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [waiting, setWaiting] = useState(false);
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
  const abortRef = useRef<AbortController | null>(null);
  // Mirror of `streaming` readable synchronously from the AppState listener
  // (which can't see React state directly).
  const streamingRef = useRef(false);
  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);
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
    if (params.prefill) setInput(String(params.prefill));
  }, [params.prefill]);

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
      setMessages((prev) =>
        prev.length === 0
          ? [{ role: "assistant", content: returning ? WELCOME_RETURNING : WELCOME_FIRST_TIME }]
          : prev,
      );
    })();
    return () => {
      cancelled = true;
    };
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
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated }));
  }, []);

  // Open the photo library and stash the chosen image as a pending attachment.
  // We downscale to <=1280px wide and JPEG-compress it so a phone screenshot
  // (often a multi-MB PNG) becomes a small base64 payload, well under the API's
  // 5MB body cap and fast for the vision model. launchImageLibraryAsync uses the
  // system photo picker, which needs no runtime permission on modern iOS/Android.
  const MAX_IMAGES = 3;
  const pickImage = useCallback(async () => {
    if (streaming || pickingImage) return;
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
        const actions = asset.width && asset.width > 1280 ? [{ resize: { width: 1280 } }] : [];
        const out = await ImageManipulator.manipulateAsync(asset.uri, actions, {
          compress: 0.6,
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
  }, [streaming, pickingImage, attachedImages.length]);

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
      },
    ) => {
      const replay = opts?.replay ?? null;
      const trimmed = text.trim();
      const images = replay ? [] : attachedImages;
      if ((!trimmed && !images.length) || streaming) return;
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

      const history: UIMessage[] = [
        ...messages,
        { role: "user", content: trimmed, imageUris: images.length ? images.map((im) => im.uri) : undefined },
      ];
      // A "scan/analyze my ticket" ask shows a Ticket Scan summary card above the
      // streamed breakdown. Snapshot the slip NOW (with each leg's edge note) so
      // the card's real metrics stay correct even if the slip later changes.
      const analyzeSlipSnapshot: TicketScanLeg[] | undefined =
        wantsAnalyzeSlip(trimmed) && legs.length
          ? legs.map((l) => ({ pick: l.pick, odds: l.odds, edge: l.edge }))
          : undefined;
      setMessages([
        ...history,
        { role: "assistant", content: "", ...(analyzeSlipSnapshot ? { analyzeSlip: analyzeSlipSnapshot } : {}) },
      ]);
      setWaiting(true);
      setStreaming(true);
      scrollToEnd();

      const controller = new AbortController();
      abortRef.current = controller;

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
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { role: "assistant", content: "", ...card };
            return copy;
          });
          scrollToEnd();

          // A pure lookup ("Wembanyama points last 10 games") is fully answered
          // by the card above. But an opinion/projection question ("how many
          // points do you think he'll score tonight?") wants the coach's actual
          // take — so we keep the card AND stream a grounded answer that uses
          // ONLY the card's real numbers (never fabricated).
          if (isProjectionQuestion(trimmed)) {
            setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
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
                content: m.content,
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
                    copy[copy.length - 1] = { role: "assistant", content: sofar };
                    return copy;
                  });
                  scrollToEnd(false);
                },
              });
              setMessages((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: "assistant", content: full };
                return copy;
              });
            } catch (e: any) {
              if (e?.name === "AbortError") {
                // Drop the empty grounded-answer placeholder on cancel.
                setMessages((prev) => {
                  const copy = [...prev];
                  const last = copy[copy.length - 1];
                  if (last && last.role === "assistant" && !last.content) copy.pop();
                  return copy;
                });
              } else {
                setMessages((prev) => {
                  const copy = [...prev];
                  copy[copy.length - 1] = {
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
          scrollToEnd();
          return;
        }
      } catch (e: any) {
        if (e?.name === "AbortError") {
          setWaiting(false);
          setStreaming(false);
          abortRef.current = null;
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
        const thinSlateDepth = requestedLegs >= 9 && wantsTodayOnly(trimmed);
        const includePeriods = wantsPeriodMarkets(trimmed) || singleGameDepth || thinSlateDepth;
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
        const isParlayBuild = PARLAY_BUILD_RE.test(trimmed) || requestedLegs > 0;

        // These are the same four pieces buildChatContext returns; in replay mode
        // we read them from the locally-saved PendingBuild instead of fetching.
        let context: ChatContext;
        let propPool: PropPoolEntry[];
        let gameMeta: GameMeta[];
        let todayOnly: boolean;
        let full: string;
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
          setWaiting(false);
        } else {
          ({ context, propPool, gameMeta, todayOnly } = await buildChatContext(
            DEFAULT_SPORTS,
            slipForContext,
            controller.signal,
            oddsThreshold,
            includePeriods,
            trimmed,
            altSign,
            requestedLegs,
            wantsAnalyzeSlip(trimmed),
          ));
          // "Today / tonight" ask: buildChatContext already restricts the pools to
          // today's upcoming games AND returns the EFFECTIVE decision it applied.
          // We reuse that `todayOnly` (NOT a fresh wantsTodayOnly) so the post-parse
          // pick filter below stays consistent with the context build.
          if (modelStrengths.length > 0) context.modelStrengths = modelStrengths;
          const apiMessages: ChatMessage[] = history.map((m) => ({
            role: m.role,
            content: m.content,
          }));

          // Background-finish: a signed-in parlay build is eligible to keep going
          // server-side if the app is backgrounded. We save the LOCAL context
          // (keyed by buildId) FIRST so a kill/relaunch can still rebuild the
          // cards, then pass the same buildId + opt-in flag to the server. A
          // non-parlay chat or signed-out user just streams normally.
          const bg = shouldHandOffBuild({ isParlayBuild, isSignedIn: !!isSignedIn });
          const buildId = bg ? makeBuildId() : "";
          if (bg) {
            pendingBgRef.current = { buildId };
            handedOffRef.current = false;
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
          full = await streamChat({
            messages: apiMessages,
            context,
            imageDataUrls: outgoingImageDataUrls,
            signal: controller.signal,
            notifyOnBackground: bg,
            buildId,
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
          // Streamed to completion in-app — no background hand-off happened, so
          // drop the pending record and its eligibility flag.
          if (bg) {
            pendingBgRef.current = null;
            await clearPendingBuild();
          }
        }
        // Merge server rows the client pool is missing (the client pool wins on
        // collision so its render metadata — headshot/teamAbbr — is preserved).
        const mergedPropPool: PropPoolEntry[] = (() => {
          if (serverPropPool.length === 0) return propPool;
          const key = (e: PropPoolEntry) =>
            `${e.game}|${e.player}|${e.line}|${e.side}|${e.marketLabel}`.toLowerCase();
          const seen = new Set(propPool.map(key));
          const extra = serverPropPool.filter((e) => !seen.has(key(e)));
          return extra.length ? [...propPool, ...extra] : propPool;
        })();

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
        let picks = isAnalyze
          ? []
          : parsePicks(full, context.realOdds, mergedPropPool, gameMeta, altRungBias);
        // Belt-and-braces: when matchupHistory.mlLean names a winner, never render
        // an opposing ML/spread card — swap to the real posted line on the lean
        // side or drop. Variety rotates games/props/markets, not WHO wins.
        let mlLeanNote = "";
        if (!isAnalyze && picks.length > 0 && context.matchupHistory) {
          const enforced = enforceMlLeanOnPicks(picks, {
            matchupHistory: context.matchupHistory,
            realOdds: context.realOdds,
            gameMeta,
          });
          picks = enforced.picks;
          mlLeanNote = mlLeanEnforcementNote(enforced);
        }
        // Props-only ask: drop any game-level legs the model slipped in (ML/spread/
        // total). The reach-count backfill below will fill from realProps instead.
        const mentionsProps = mentionsPropIntent(trimmed);
        const propsOnlyTicket = wantsPropsOnly(trimmed);
        const lockedPropMarket =
          mentionsProps &&
          /\b(strikeouts?|k'?s|home runs?|hrs?|hits?|total bases?|rebounds?|reb|assists?|ast|points?|pts|anytime td|touchdowns?|receptions?|pass yds?|rush yds?|rec yds?|goals?|shots on goal)\b/i.test(
            trimmed,
          );
        const propBackfillOpts = {
          plusMoneyBias:
            wantsValueRungs ||
            /\b(?:long\s?shots?|longshots?|lottery)\b/i.test(trimmed),
          diversify: !lockedPropMarket,
          maxPerMarket: lockedPropMarket ? 99 : undefined,
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
                ? `\n\n_No real legs on tonight's board were priced ${bound}, so there's nothing to show for that bound right now — try a looser number or a different market._`
                : `\n\n_Showing the ${picks.length} real leg${picks.length === 1 ? "" : "s"} priced ${bound}; dropped ${dropped} that didn't qualify._`;
          }
        }
        // Confidence-threshold lock: drop any resolved leg whose signals-based
        // Confidence falls outside the requested band. Confidence is a baseline
        // plus points for each strong REAL rubric signal (matchup, trend, line
        // value, injury, line shopping) — the card renders it 0–100, this filter
        // compares it on the same value's 0–10 band (confidenceScoreFromSignals).
        // This is the hard guarantee — the server prompt steers the model toward
        // picks with many strong signals, but only this filter makes EVERY rendered
        // card actually sit in the band. Legs are scored off the SAME real context
        // the cards render from (attachPickScores), so the filter and the displayed
        // number agree. A leg with no groundable signal scores null and is excluded
        // — there is nothing to back a confidence claim. Never fabricates/inflates.
        let confidenceNote = "";
        if (confidenceThreshold) {
          const before = picks.length;
          const scored = attachPickScores(picks, {
            realOdds: context.realOdds,
            propPool: mergedPropPool,
            matchupHistory: context.matchupHistory,
            matchupInjuries: context.matchupInjuries,
            perfByFamily: marketPerf,
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
                ? `\n\n_None of tonight's grounded legs have enough strong signals behind them to reach ${band} confidence right now — that score is built from each leg's real matchup, form, line value, injury and price edges, and I won't invent a signal to fake the number. Try a lower confidence or a different market._`
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
                ? `\n\n_No real ${word} alt legs were available on tonight's board, so there's nothing to show for a ${altSign === "plus" ? "+" : "-"} alt right now — try the other sign or a bare alt._`
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
        // Set when the today-only salvage below actually built a real ticket out
        // of nothing (the model refused / its legs were all filtered). The
        // model's streamed prose (`full`) is then a refusal or stripped scaffold
        // that contradicts the real cards we're about to show, so finalContent
        // gets a clean lead-in instead of that prose.
        let salvageBuilt = false;
        if (todayOnly) {
          const before = picks.length;
          picks = picks.filter((p) => startsTodayUpcoming(p.startsAt));
          // SALVAGE — the model emitted a ticket but EVERY leg got filtered out
          // (it reached for props on non-today games via the server's prop
          // backfill, or whiffed) WHILE the user named a sport that still has a
          // real upcoming-today game on the board. Rather than show zero, build
          // the best real ticket today's remaining game(s) honestly support from
          // their full-game mains — never fabricating: backfillPicks only appends
          // real realOdds entries, which are already today-filtered here, so every
          // leg is real, today, and upcoming. One soccer match can't honestly
          // yield 7 uncorrelated legs, so this often lands short of the requested
          // count — the honest leg-count note below says exactly how many held up.
          // Runs for a NAMED sport AND for a generic "N-leg ... tonight" ask: a
          // late-evening generic ask whose only remaining today game(s) can't fill
          // the count (the model grounds legs on non-today backfill that then gets
          // filtered) would otherwise fall through to a flat refusal. Skipped under
          // the odds/confidence locks whose own filters stay
          // authoritative. backfillPicks' own (game, market-family) dedup keeps the
          // salvage to one main per family per game, so it never stacks correlated
          // same-line sides even when the whole ticket sits on one game.
          // NOTE: this fires even when the model emitted ZERO PICK lines. For an
          // ask one real game can't honestly fill ("7 leg soccer parlay" with one
          // soccer match on the board), the model often REFUSES outright rather
          // than return legs that then get filtered — so an `emittedPickLines > 0`
          // gate would skip the salvage exactly when it's needed and the user just
          // sees the generic "board is thin" refusal. A genuine build request is
          // signalled by an explicit leg count (requestedLegs > 0), which is enough
          // to safely build from today's already-filtered real odds.
          const salvageEligible =
            picks.length === 0 &&
            requestedLegs > 0 &&
            !oddsThreshold &&
            !confidenceThreshold &&
            // A "+ alt" / "- alt" sign lock already ran its own filter above; a
            // salvage of unsigned game mains would violate the requested sign, so
            // skip it. A props-only / prop-market ask wants players, not game
            // moneylines, so don't silently fall back to game mains there either.
            !altSign;
          const salvageSports = salvageEligible
            ? focalSportsFromText(trimmed)
            : new Set<string>();
          if (salvageEligible) {
            const tgt = Math.min(requestedLegs, MAX_LEGS);
            if (mentionsPropIntent(trimmed)) {
              const salvagePool =
                salvageSports.size > 0
                  ? context.realOdds.filter((e) => salvageSports.has(e.sport))
                  : context.realOdds;
              picks = backfillProps([], mergedPropPool, salvagePool, gameMeta, {
                target: tgt,
                ...propBackfillOpts,
              });
              if (!propsOnlyTicket && picks.length < tgt) {
                picks = backfillPicks(picks, salvagePool, gameMeta, {
                  target: tgt,
                  order: GENERIC_BACKFILL_ORDER,
                });
              }
              if (picks.length > 0) salvageBuilt = true;
            } else {
            // Named sport → salvage only that sport's remaining today games; a
            // GENERIC "N-leg parlay for tonight" (no sport named) → salvage from
            // EVERY today-upcoming game on the board. context.realOdds is already
            // startsTodayUpcoming-filtered here, so either pool is real + today +
            // upcoming and nothing is invented.
            const salvagePool =
              salvageSports.size > 0
                ? context.realOdds.filter((e) => salvageSports.has(e.sport))
                : context.realOdds;
            if (salvagePool.length > 0) {
              picks = backfillPicks([], salvagePool, gameMeta, {
                target: tgt,
                order: GENERIC_BACKFILL_ORDER,
              });
              // Top up with REAL player/game props from the SAME today-upcoming
              // games so the salvage ticket isn't all moneylines/spreads on one
              // match (user: "what about all the player and game props"). Honest:
              // backfillProps only emits real posted prop lines and is today-gated
              // to the games in salvagePool (already startsTodayUpcoming-filtered),
              // so it never fabricates or reaches a tomorrow/started game. When the
              // game has no real props (e.g. club soccer) it adds nothing and the
              // ticket stays game-lines only — still honest, still real.
              picks = backfillProps(picks, mergedPropPool, salvagePool, gameMeta, {
                target: tgt,
                ...propBackfillOpts,
              });
              if (picks.length > 0) salvageBuilt = true;
            }
            }
          }
          // Honest, non-contradictory note (pure helper, unit-tested in
          // slate.test.ts) — only when the salvage above ALSO came up empty (no
          // real today game in the named sport, or no sport named). Never claims
          // "nothing is upcoming"; todayOnly being true guarantees a game is still
          // to come, so it distinguishes "legs were on started/non-today games"
          // (before>0) from "slate too thin to ground the requested ticket"
          // (before===0, the soccer case).
          if (picks.length === 0) {
            todayNote = todayBuildNote({
              before,
              surviving: picks.length,
              // Treat any salvage-eligible build (named OR generic) that still
              // produced nothing the same as an emitted one so the note is the
              // honest "slate too thin / nothing today" message instead of silence
              // — silence would fall through to the generic backstop refusal. This
              // only reaches here when the salvage above also came up empty (no real
              // today odds at all), which is rare since todayOnly guarantees a
              // qualifying start time, but possible if that game carried no odds.
              emittedPickLines: emittedPickLines || (salvageEligible ? requestedLegs : 0),
            });
          }
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
        if (
          requestedLegs > picks.length &&
          (picks.length > 0 || mentionsProps) &&
          !oddsThreshold &&
          !confidenceThreshold
        ) {
          const target = Math.min(requestedLegs, MAX_LEGS);
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
            : context.realOdds;
          if (lockedSports)
            backfillPool = backfillPool.filter((e) => lockedSports.has(e.sport));
          if (altSign) {
            picks = backfillPicks(picks, backfillPool, gameMeta, {
              target,
              altSign,
              order: ALT_BACKFILL_ORDER,
            });
          } else {
            // High-leg "tonight" asks must reach N across the FULL slate — props
            // first (the board has hundreds), then game mains, then period markets.
            // Do NOT infer a single-game lock just because the model's first legs
            // landed on one matchup (the reported 15-leg → 3-leg bug).
            const deepTonightFill =
              thinSlateDepth && !explicitSingleGame && requestedLegs >= 9;
            if (mentionsProps || deepTonightFill) {
              picks = backfillProps(picks, mergedPropPool, backfillPool, gameMeta, {
                target,
                ...propBackfillOpts,
              });
              if (!propsOnlyTicket && picks.length < target) {
                picks = backfillPicks(picks, backfillPool, gameMeta, {
                  target,
                  order: GENERIC_BACKFILL_ORDER,
                });
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
        // Belt-and-braces for the 15-leg slip cap: the server prompt already tells
        // the model never to build more than MAX_LEGS legs, but if it ever drifts
        // (e.g. a "100 leg" ask), never RENDER or OFFER more cards than the slip
        // can hold — truncate the resolved picks to MAX_LEGS. These are already
        // REAL, resolved entries, so this only ever drops extras, never fabricates.
        if (picks.length > MAX_LEGS) {
          picks = picks.slice(0, MAX_LEGS);
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
          realOdds: context.realOdds,
          propPool: mergedPropPool,
          matchupHistory: context.matchupHistory,
          matchupInjuries: context.matchupInjuries,
          perfByFamily: marketPerf,
        });
        // Transparency note. When the user asked for a specific leg count and we
        // delivered fewer (even after the alt backstop above), say why — the
        // lead-in prose is hidden once cards render (assistantBubbleText returns
        // "" when picks exist), so this is the ONLY place the user learns the
        // ticket was trimmed. Two reasons: (1) tickets cap at the 15-leg slip max,
        // or (2) the real board was too thin to ground that many legs. We never
        // pad with invented legs.
        let legNote = "";
        if (picks.length > 0 && requestedLegs > picks.length) {
          legNote =
            requestedLegs > MAX_LEGS && picks.length >= MAX_LEGS
              ? `Tickets cap at ${MAX_LEGS} legs — here's the strongest ${MAX_LEGS}-leg version of your ${requestedLegs}-leg request.`
              : `You asked for ${requestedLegs} legs, but only ${picks.length} held up against tonight's real odds — that's the honest ticket, I won't pad it with invented legs.`;
        }
        if (mlLeanNote) {
          legNote = legNote ? `${legNote}\n\n${mlLeanNote}` : mlLeanNote;
        }
        if (propsOnlyNote) {
          legNote = legNote ? `${legNote}\n\n${propsOnlyNote}` : propsOnlyNote;
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
        if (salvageBuilt && picks.length > 0) {
          // The salvage built a real ticket out of nothing; the model's own prose
          // was a refusal / stripped scaffold that contradicts the cards. Replace
          // it with a clean lead-in. legNote (rendered below) carries the honest
          // "you asked for N, only X held up" count when the ticket lands short.
          finalContent =
            "Here's the strongest real ticket today's slate supports right now — every leg is a live price, nothing invented.";
        } else if (picks.length === 0 && emittedPickLines > 0) {
          const lead = assistantBubbleText(full, false);
          const note =
            thresholdNote ||
            confidenceNote ||
            signNote ||
            todayNote ||
            "\n\n_I couldn't ground any of those legs in tonight's real odds right now — the board may be thin or between updates. Try again in a moment, or ask for a specific game or market._";
          finalContent = `${lead}${note}`.trim();
        }
        // Absolute backstop for any other blank reply (e.g. an empty stream) so a
        // 200 with no visible content never lands as a silent dead end.
        if (picks.length === 0 && assistantBubbleText(finalContent, false).trim() === "") {
          finalContent =
            "I couldn't put together a grounded reply just now — the live board may be thin or between updates. Try again in a moment, or ask for a specific game, player, or market.";
        }
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            ...copy[copy.length - 1],
            role: "assistant",
            content: finalContent,
            picks,
            ...(legNote ? { legNote } : {}),
          };
          return copy;
        });
        // Surface this parlay's picks on the Player Props + Picks tabs. Only
        // overwrite when we actually resolved real picks so a plain Q&A reply
        // doesn't wipe the last recommendation.
        if (picks.length > 0) setAiPicks(picks);
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
          if (pendingBgRef.current) setBgWatchId(pendingBgRef.current.buildId);
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = {
              role: "assistant",
              content:
                "Still building your ticket — I'll keep going even though you stepped away and send you a notification the moment it's ready.",
            };
            return copy;
          });
        } else if (e?.name !== "AbortError") {
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = {
              role: "assistant",
              content: chatStreamFailureMessage(e),
            };
            return copy;
          });
        }
      } finally {
        setWaiting(false);
        setStreaming(false);
        abortRef.current = null;
        scrollToEnd();
      }
    },
    [
      messages,
      slipForContext,
      streaming,
      scrollToEnd,
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
          maxWaitMs: PENDING_BUILD_MAX_WAIT_MS,
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
        }
      }
    });
    return () => sub.remove();
  }, [restoreBackgroundBuild]);

  // While a build is handed off, poll the server stash on a timer so the result
  // replays the moment it's ready — and, if it never arrives, the wait-timeout in
  // decideBackgroundRestore turns it into a "couldn't finish — try again" recovery
  // instead of an endless "still building". Covers the case where the user just
  // sits on the screen and never re-foregrounds the app. Cleared once the build
  // resolves (replay/failed clear bgWatchId) or a new stream starts.
  useEffect(() => {
    if (!bgWatchId) return;
    const id = setInterval(() => {
      const pend = pendingBgRef.current;
      if (!pend || streamingRef.current) return;
      void restoreBackgroundBuild(pend.buildId, { auto: true });
    }, PENDING_POLL_MS);
    return () => clearInterval(id);
  }, [bgWatchId, restoreBackgroundBuild]);

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
    if (params.send !== "1" || !params.prefill) return;
    const token = String(params.ts ?? params.prefill);
    if (autoSentRef.current === token) return;
    if (streaming) return;
    autoSentRef.current = token;
    send(String(params.prefill));
  }, [params.send, params.ts, params.prefill, streaming, send]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ paddingTop: insets.top + 8, paddingLeft: 64, paddingRight: 16, paddingBottom: 12 }}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 24 }}>
          AI Coach
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, marginTop: 2 }}>
          Picks grounded in tonight&apos;s real odds — never invented
        </Text>
      </View>

      <KeyboardAwareScrollViewCompat
        ref={scrollRef as any}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 + slipClearance }}
        bottomOffset={12}
      >
        <View style={{ gap: 14, paddingTop: 4 }}>
          {messages.map((m, i) => {
            const hasPicks = !!(m.picks && m.picks.length > 0);
            const isWaiting = m.role === "assistant" && m.content === "" && waiting;
            // A parlay still mid-stream: PICK lines have arrived in the raw text
            // but haven't been parsed into cards yet. Show a "Building…" hint
            // instead of leaving the user staring at stripped/empty text.
            // A parlay BUILD is in flight when either the user explicitly asked to
            // build one (catches the early stream BEFORE any PICK line, so the
            // lead-in prose never flashes) or PICK lines have started arriving.
            const parlayBuildIntent =
              m.role === "assistant" && PARLAY_BUILD_RE.test(messages[i - 1]?.content || "");
            const isBuildingParlay =
              m.role === "assistant" &&
              streaming &&
              i === messages.length - 1 &&
              !hasPicks &&
              (parlayBuildIntent ||
                m.content.split("\n").some((l) => PICK_SCAFFOLD_RE.test(l.trim())));
            // Live progress for the build indicator: a full-context parlay can take
            // ~15s of model time, and since the lead-in prose is hidden the user
            // would otherwise stare at a static spinner. Counting completed PICK
            // lines as they stream in gives real "it's working" feedback.
            const buildingLegCount = isBuildingParlay
              ? m.content
                  .split("\n")
                  // Require 3 pipes (4 fields) so only fully-streamed PICK lines
                  // count — mirrors parsePicks' parts.length >= 4 so the running
                  // total never transiently overshoots a half-emitted line.
                  .filter((l) => /^PICK\s*:.*\|.*\|.*\|/i.test(l.trim())).length
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
            const askWaiting = isWaiting && !isBuildingParlay && !analyzeWaiting;
            const bubbleText =
              m.role === "assistant" ? assistantBubbleText(m.content, hasPicks) : m.content;
            // Drop the bubble entirely when a pick reply left no lead-in text —
            // the cards (and their EDGE notes) carry everything. Also hide it while
            // a parlay is building (the AnalysisProgress card stands in) or while an
            // analyze request is waiting, so no empty/spinner bubble flashes ahead
            // of the dedicated progress UI.
            const showBubble =
              !m.statCard &&
              !m.periodGameLog &&
              !m.teamCard &&
              !isBuildingParlay &&
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
                  <PlayerStatCard data={m.statCard} />
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
                {isBuildingParlay ? (
                  <AnalysisProgress mode="build" legCount={buildingLegCount} />
                ) : analyzeWaiting ? (
                  <AnalysisProgress mode="analyze" />
                ) : askWaiting ? (
                  <AnalysisProgress mode="ask" />
                ) : null}

                {hasPicks ? (
                  <View style={{ gap: 8, marginTop: 10 }}>
                    {m.legNote ? (
                      <Text
                        style={{
                          color: colors.mutedForeground,
                          fontFamily: FONT.medium,
                          fontSize: 12,
                          fontStyle: "italic",
                        }}
                      >
                        {m.legNote}
                      </Text>
                    ) : null}
                    {m.picks!.length > 1 ? (
                      <AddAllButton
                        picks={m.picks!}
                        slipCount={legs.length}
                        addLeg={addLeg}
                        removeLeg={removeLeg}
                        hasLeg={hasLeg}
                      />
                    ) : null}
                    {m.picks!.map((p, j) => (
                      <PickCard key={`${i}-${j}`} pick={p} onPress={statsHandlerFor(p)} />
                    ))}
                  </View>
                ) : null}

                {m.retry ? (
                  <Pressable
                    onPress={() => send(m.retry!)}
                    disabled={streaming}
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
                      opacity: streaming ? 0.5 : pressed ? 0.85 : 1,
                    })}
                  >
                    <Feather name="refresh-cw" size={16} color={colors.foreground} />
                    <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
                      Try again
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}

          {messages.length <= 1 ? (
            <View style={{ gap: 8, marginTop: 4 }}>
              {QUICK_PROMPTS.map((q) => (
                <Pressable
                  key={q.label}
                  onPress={() => send(q.prompt)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                    padding: 14,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Feather name="zap" size={16} color={colors.accent} />
                  <Text style={{ color: colors.foreground, fontFamily: FONT.medium, fontSize: 14, flex: 1 }}>
                    {q.label}
                  </Text>
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

      {/* Composer */}
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
          disabled={streaming || pickingImage || attachedImages.length >= MAX_IMAGES}
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
              pressed || streaming || attachedImages.length >= MAX_IMAGES ? 0.6 : 1,
          })}
        >
          {pickingImage ? (
            <ActivityIndicator color={colors.mutedForeground} size="small" />
          ) : (
            <Feather name="image" size={20} color={colors.mutedForeground} />
          )}
        </Pressable>
        <TextInput
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
          disabled={(!input.trim() && !attachedImages.length) || streaming}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor:
              (!input.trim() && !attachedImages.length) || streaming ? colors.card : colors.primary,
            borderWidth: (!input.trim() && !attachedImages.length) || streaming ? 1 : 0,
            borderColor: colors.border,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.85 : 1,
          })}
        >
          {streaming ? (
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
      </KeyboardStickyView>
    </View>
  );
}
