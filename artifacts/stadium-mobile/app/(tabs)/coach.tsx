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
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { PeriodGameLogCard, type PeriodGameLogCardData } from "@/components/PeriodGameLogCard";
import {
  PickCard,
  gameSideFromPick,
  parsePicks,
  backfillPicks,
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
import { parseOddsThreshold, oddsSatisfiesThreshold, wantsPeriodMarkets } from "@/lib/format";
import { FONT } from "@/components/ui";
import { useCoachSlipClearance } from "@/components/SlipBar";
import { useBetSlip, MAX_LEGS } from "@/context/BetSlipContext";
import { useColors } from "@/hooks/useColors";
import { computeModelStrengths } from "@/lib/modelReport";
import {
  buildChatContext,
  gameMatchesFocalText,
  getPlayerHistory,
  getStatmuseGamelog,
  getTeamHistory,
  propPoolFromRealProps,
  searchPlayer,
  searchTeam,
  startsTodayUpcoming,
  streamChat,
  type AltSign,
  type ChatMessage,
  type PropPoolEntry,
  type RealPropEntry,
} from "@/lib/api";
import { DEFAULT_SPORTS } from "@/lib/sports";
import { NAME_FALLBACK_SKIP, parseStatLookup } from "@/lib/statLookup";

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
};

type StatCardResult = {
  statCard?: PlayerStatCardData;
  periodGameLog?: PeriodGameLogCardData;
  teamCard?: TeamStatCardData;
};

// Resolve a player/stat question into a REAL stat card. Returns null when the
// message isn't a stat lookup or no real player/data resolves — the caller then
// falls back to the AI chat path. Throws AbortError if cancelled. Never
// fabricates: every value comes from ESPN (player-history) or StatMuse's real
// results grid (statmuse-gamelog).
async function tryStatCard(text: string, signal: AbortSignal): Promise<StatCardResult | null> {
  const lookup = parseStatLookup(text);
  if (!lookup) return null;

  const sr = await searchPlayer(lookup.name, signal);
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
  if (!top && !lookup.bareName) {
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
          const fr = await searchPlayer(cand, signal);
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

function assistantBubbleText(content: string, hasPicks: boolean): string {
  if (hasPicks) return "";
  const lines = content.split("\n");
  const idx = lines.findIndex((l) => PICK_SCAFFOLD_RE.test(l.trim()));
  if (idx === -1) return content.trim();
  return lines.slice(0, idx).join("\n").trim();
}

// Does the user want the coach's TAKE/projection, not just the raw stat card?
// A pure lookup ("Wembanyama points last 10 games") is fully answered by the
// card, but an opinion/projection question ("how many points do you think he'll
// score tonight?", "is the over a good bet?") wants an actual answer — so we
// keep showing the real card AND stream a grounded reply.
const PROJECTION_RE =
  /\b(do you think|you think|think (?:he|she|they|it)|predict(?:ion)?|project(?:ion|ed|ing)?|expect(?:ed|ing|s)?|forecast|your (?:take|thoughts|opinion|guess|prediction|call)|thoughts on|over or under|over\/under|o\/u|should i|good bet|worth (?:a )?(?:bet|play|shot)|likely to|going to|gonna)\b/i;
const PROJECTION_WILL_RE =
  /\bwill\s+[a-z.'’\- ]{2,30}?\s(?:score|get|have|put up|go for|drop|record|tally|hit|reach|exceed)\b/i;

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
  const slipClearance = useCoachSlipClearance();
  const router = useRouter();
  const params = useLocalSearchParams<{ prefill?: string; send?: string; ts?: string }>();
  const autoSentRef = useRef<string | null>(null);

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
      if (!side || !p.sport) return undefined;
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

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
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
    async (text: string) => {
      const trimmed = text.trim();
      const images = attachedImages;
      if ((!trimmed && !images.length) || streaming) return;
      setInput("");
      setAttachedImages([]);

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
      setMessages([...history, { role: "assistant", content: "" }]);
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
        const card = hasOutgoingImages ? null : await tryStatCard(trimmed, controller.signal);
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
                  scrollToEnd();
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
        // Period/same-game ask ("2nd-half ticket", "Q3 legs", "same game"): surface
        // game-level period markets (1H/2H/Q1–Q4) in the context so the model has
        // real period legs to build from instead of honestly refusing.
        const includePeriods = wantsPeriodMarkets(trimmed);
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
        const { context, propPool, gameMeta, todayOnly } = await buildChatContext(
          DEFAULT_SPORTS,
          slipForContext,
          controller.signal,
          oddsThreshold,
          includePeriods,
          trimmed,
          altSign,
        );
        // "Today / tonight" ask: buildChatContext already restricts the pools to
        // today's upcoming games AND returns the EFFECTIVE decision it applied.
        // We reuse that `todayOnly` (NOT a fresh wantsTodayOnly) so the post-parse
        // pick filter below stays consistent with the context build: when the
        // late-evening fallback relaxed the restriction (tonight's slate already
        // started, only tomorrow's games left), we must NOT re-impose it here and
        // zero out the real tomorrow slate. When today-only IS in force, the
        // server's fresh-fetch backfill can still surface a tomorrow/started prop
        // the model picks, so we re-check the resolved legs so nothing off-today
        // reaches the slip.
        if (modelStrengths.length > 0) context.modelStrengths = modelStrengths;
        const apiMessages: ChatMessage[] = history.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        let first = true;
        // The server streams back the EXACT prop pool the model saw (post
        // market-lock filter + fresh-fetch backfill). The local propPool is capped
        // to the soonest games and can miss late-starting games, so without this
        // the matcher fail-closes a perfectly real later-game prop ticket. Merge
        // the server rows in (dedup by game|player|line|side|market) before
        // parsePicks runs. Real bookmaker rows only — never fabricated.
        const serverPropPool: PropPoolEntry[] = [];
        const full = await streamChat({
          messages: apiMessages,
          context,
          imageDataUrls: outgoingImageDataUrls,
          signal: controller.signal,
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
              copy[copy.length - 1] = { role: "assistant", content: sofar };
              return copy;
            });
            scrollToEnd();
          },
        });
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
        let picks = parsePicks(full, context.realOdds, mergedPropPool, gameMeta, altRungBias);
        // How many real PICK scaffold lines the model emitted (whether or not each
        // resolved to a real odds entry). Counted by the pipe-delimited shape
        // (PICK: + 4 fields) — same as parsePicks / the building-leg counter — so
        // prose that merely contains "PICK:" never trips the empty-bubble note.
        const emittedPickLines = full
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
        if (todayOnly) {
          const before = picks.length;
          picks = picks.filter((p) => startsTodayUpcoming(p.startsAt));
          const dropped = before - picks.length;
          if (dropped > 0 || (picks.length === 0 && emittedPickLines > 0)) {
            todayNote =
              picks.length === 0
                ? `\n\n_Nothing on today's board is still upcoming for that — every game I could pull has already started or isn't until later. Ask without limiting to today, or check back as more of today's games approach tip-off._`
                : `\n\n_Showing the ${picks.length} real leg${picks.length === 1 ? "" : "s"} for games still to start today; dropped ${dropped} that already started or aren't today._`;
          }
        }
        // The number of legs the user explicitly asked for (0 when unspecified).
        const requestedLegs = requestedLegCount(trimmed);
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
        if (requestedLegs > picks.length && picks.length > 0 && !oddsThreshold) {
          const target = Math.min(requestedLegs, MAX_LEGS);
          if (altSign) {
            picks = backfillPicks(picks, context.realOdds, gameMeta, {
              target,
              altSign,
              order: ALT_BACKFILL_ORDER,
            });
          } else if (includePeriods) {
            picks = backfillPicks(picks, context.realOdds, gameMeta, {
              target,
              order: PERIOD_BACKFILL_ORDER,
            });
          } else {
            // PLAIN N-leg parlay (no alt / period / threshold lock). The model
            // routinely returns a leg or two short even when the board has plenty
            // more real games — a "4 leg" ask coming back with 3 is the reported
            // failure. Deterministically fill toward N from real FULL-GAME mains
            // (one per distinct unused game), never fabricating. Derive the
            // constraints from the model's OWN resolved legs so we never widen a
            // locked ask: (a) skip the game-main fill ONLY when the user actually
            // asked for props (props-only / a specific prop market) AND every
            // resolved leg is a prop — a game-level main would be off-intent
            // there; (b) when every game-level leg sits on ONE game (a
            // single-game lock), restrict the fill to that same game so we don't
            // pull in other matchups.
            const allProps = picks.every((p) => p.isProp);
            // Did the USER express prop intent? A GENERIC "6-leg parlay for
            // tonight" carries none of these words, so when the model merely
            // HAPPENS to return all props we must still backfill toward N with
            // real game mains — otherwise "6-leg parlay" → 2 props → "only 2
            // held up" on a full board (the reported bug). Mirrors (loosely) the
            // server's MARKET_KEYWORDS so a real props-only / prop-market lock
            // ("player props only", "6 home run hitters", "strikeout parlay")
            // still skips the game-main fill and stays in props.
            const mentionsProps =
              /\b(props?|prop bets?|player props?)\b/i.test(trimmed) ||
              /\b(strikeouts?|k'?s|home runs?|hr|anytime td|anytime touchdowns?|touchdowns?|goal scorer|anytime goal|first goal|shots on target|sot|shots on goal|sog|shots?|passing yards?|pass yds?|rushing yards?|rush yds?|receiving yards?|rec yds?|receptions?|sacks?|pra|rebounds?|reb|assists?|ast|threes|3pm|3-?pointers?|stolen bases?|blocks?|blk|steals?|stl|turnovers?|hits?|total bases?)\b/i.test(
                trimmed,
              ) ||
              /\b(points?|pts)\b(?=[^\n]{0,40}\b(props?|prop bet|parlay|legs?|over|under|line|ticket|\d+(?:\.\d+)?)\b)|\b(props?|prop bet|parlay|legs?|over|under|line|ticket|\d+(?:\.\d+)?)\b[^\n]{0,40}\b(points?|pts)\b/i.test(
                trimmed,
              );
            if (!allProps || !mentionsProps) {
              const gameLegs = picks.filter((p) => !p.isProp);
              // SINGLE-GAME LOCK — only when EVERY resolved leg (props INCLUDED)
              // sits on the SAME one game, i.e. a genuine single-game parlay. The
              // old check looked only at game-level legs, so a ticket of 2 props
              // from different WNBA games + 1 lone MLB ML wrongly locked the fill
              // pool to that one MLB game and starved the backfill (→ "only 3 held
              // up" on a 6-game board). Counting ALL legs' games fixes that: when
              // the props come from other matchups the set is >1 and we fill from
              // the whole board.
              // A genuine SINGLE-GAME parlay locks the fill to that one game.
              // But a lone resolved leg also trivially has one distinct game, so
              // gating on `size === 1` alone wrongly locked a GENERIC "3-leg
              // parlay for tonight" that happened to ground just one prop to that
              // prop's game — then that game's mains were thin and the ticket
              // stayed at 1 leg (the reported bug). Only lock when the intent is
              // truly single-game: either the model resolved 2+ legs all on that
              // SAME game, OR the user actually NAMED that game in their ask.
              // Otherwise fill from the whole board so a generic N-leg ask reaches
              // its count across other matchups.
              const onlyGameLabel =
                new Set(picks.map((p) => norm(p.game))).size === 1
                  ? picks[0].game
                  : null;
              const lockedGame =
                onlyGameLabel &&
                (picks.length >= 2 || gameMatchesFocalText(onlyGameLabel, trimmed))
                  ? norm(onlyGameLabel)
                  : null;
              const pool = lockedGame
                ? context.realOdds.filter((e) => norm(e.game) === lockedGame)
                : context.realOdds;
              // Infer an implicit MARKET lock from the model's own resolved
              // legs: if every game-level leg sits in ONE full-game family
              // (e.g. a "spread parlay" or "moneyline parlay" that came back
              // all spreads / all MLs), constrain the fill to that same family
              // so we never widen the ticket into other markets. Otherwise fill
              // from full-game mains across all three families.
              const fams = new Set(gameLegs.map((p) => marketFamily(p.market)));
              const FAMILY_ORDER: Record<string, RegExp[]> = {
                moneyline: [/^Moneyline$/],
                spread: [/^Spread$/],
                total: [/^Total$/],
              };
              // IMPLICIT MARKET-FAMILY LOCK — only infer a "spread/ML/total
              // parlay" when the model resolved AT LEAST TWO game-level legs all in
              // ONE family. A single leaked game leg (e.g. one Phillies ML beside
              // two props) does NOT establish a market-lock intent, so it must fall
              // through to the generic mains order and fill across all three
              // families — not stay stuck on that lone leg's family.
              const lockedFam =
                gameLegs.length >= 2 && fams.size === 1 ? [...fams][0] : null;
              const order =
                lockedFam && FAMILY_ORDER[lockedFam]
                  ? FAMILY_ORDER[lockedFam]
                  : GENERIC_BACKFILL_ORDER;
              picks = backfillPicks(picks, pool, gameMeta, { target, order });
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
        // Never leave an empty, invisible assistant bubble. A parlay reply renders
        // blank when the model emitted PICK lines but NONE resolved to a real odds
        // entry (board thin / between updates): the cards are empty AND
        // assistantBubbleText() strips the raw PICK scaffold down to nothing — and
        // any note appended AFTER those PICK lines gets stripped too. So drop the
        // unbacked scaffold and keep only the lead-in prose plus an honest note
        // (the threshold note when the ask carried an odds bound), guaranteeing a
        // successful request never shows as a blank reply.
        let finalContent = full + thresholdNote + signNote + todayNote;
        if (picks.length === 0 && emittedPickLines > 0) {
          const lead = assistantBubbleText(full, false);
          const note =
            thresholdNote ||
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
        if (e?.name !== "AbortError") {
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = {
              role: "assistant",
              content: "Sorry — I lost the connection while building your ticket. Check your signal and try again.",
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
    [messages, slipForContext, streaming, scrollToEnd, attachedImages],
  );

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
    return () => abortRef.current?.abort();
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
            const bubbleText =
              m.role === "assistant" ? assistantBubbleText(m.content, hasPicks) : m.content;
            // Drop the bubble entirely when a pick reply left no lead-in text —
            // the cards (and their EDGE notes) carry everything. Also hide it while
            // a parlay is building so only the "Building your parlay…" indicator
            // shows (no intro prose lands in the chat ahead of the cards).
            const showBubble =
              !m.statCard &&
              !m.periodGameLog &&
              !m.teamCard &&
              !isBuildingParlay &&
              (isWaiting || bubbleText.length > 0 || !!m.imageUris?.length);
            return (
              <View key={i}>
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
                    {isWaiting ? (
                      <ActivityIndicator color={colors.mutedForeground} size="small" />
                    ) : bubbleText.length > 0 ? (
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

                {isBuildingParlay ? (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      alignSelf: "flex-start",
                      marginTop: 10,
                      backgroundColor: colors.card,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 999,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                    }}
                  >
                    <ActivityIndicator color={colors.accent} size="small" />
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontFamily: FONT.medium,
                        fontSize: 13,
                      }}
                    >
                      {buildingLegCount > 0
                        ? `Building your parlay… ${buildingLegCount} leg${buildingLegCount === 1 ? "" : "s"}`
                        : "Building your parlay…"}
                    </Text>
                  </View>
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
