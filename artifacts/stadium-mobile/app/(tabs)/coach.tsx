import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { PeriodGameLogCard, type PeriodGameLogCardData } from "@/components/PeriodGameLogCard";
import { PickCard, parsePicks, type ParsedPick } from "@/components/PickCard";
import { PlayerStatCard, type PlayerStatCardData } from "@/components/PlayerStatCard";
import { TeamStatCard, type TeamStatCardData } from "@/components/TeamStatCard";
import { parseOddsThreshold, oddsSatisfiesThreshold, wantsPeriodMarkets } from "@/lib/format";
import { FONT } from "@/components/ui";
import { useCoachSlipClearance } from "@/components/SlipBar";
import { useBetSlip } from "@/context/BetSlipContext";
import { useColors } from "@/hooks/useColors";
import {
  buildChatContext,
  getPlayerHistory,
  getStatmuseGamelog,
  getTeamHistory,
  searchPlayer,
  searchTeam,
  streamChat,
  type ChatMessage,
} from "@/lib/api";
import { DEFAULT_SPORTS } from "@/lib/sports";
import { NAME_FALLBACK_SKIP, parseStatLookup } from "@/lib/statLookup";

type UIMessage = {
  role: "user" | "assistant";
  content: string;
  picks?: ParsedPick[];
  statCard?: PlayerStatCardData;
  periodGameLog?: PeriodGameLogCardData;
  teamCard?: TeamStatCardData;
  // Local URI of a user-attached photo, shown in the user bubble.
  imageUri?: string;
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
          // unrelated player: the candidate must actually appear in the
          // resolved name (accent-insensitive), e.g. "wembanyama" ⊂
          // "Victor Wembanyama".
          if (hit && hit.name && norm(hit.name).includes(norm(cand))) {
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
  /\bbuild\b[^?]*\bparlay\b|\b\d{1,2}[-\s]?leg\b|\blongshot\b|\bplayer props only\b/i;

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

export default function CoachScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { legs, setAiPicks } = useBetSlip();
  const slipClearance = useCoachSlipClearance();
  const params = useLocalSearchParams<{ prefill?: string; send?: string; ts?: string }>();
  const autoSentRef = useRef<string | null>(null);

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
  const [attachedImage, setAttachedImage] = useState<{ uri: string; dataUrl: string } | null>(null);
  const [pickingImage, setPickingImage] = useState(false);

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
  const pickImage = useCallback(async () => {
    if (streaming || pickingImage) return;
    try {
      setPickingImage(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        quality: 1,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const asset = result.assets[0];
      const actions = asset.width && asset.width > 1280 ? [{ resize: { width: 1280 } }] : [];
      const out = await ImageManipulator.manipulateAsync(asset.uri, actions, {
        compress: 0.6,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      });
      if (!out.base64) return;
      setAttachedImage({ uri: out.uri, dataUrl: `data:image/jpeg;base64,${out.base64}` });
    } catch {
      /* picker/manipulation failed — leave any existing attachment unchanged */
    } finally {
      setPickingImage(false);
    }
  }, [streaming, pickingImage]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      const image = attachedImage;
      if ((!trimmed && !image) || streaming) return;
      setInput("");
      setAttachedImage(null);

      const history: UIMessage[] = [
        ...messages,
        { role: "user", content: trimmed, imageUri: image?.uri },
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
        const card = image ? null : await tryStatCard(trimmed, controller.signal);
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
              );
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
        const { context, propPool, gameMeta } = await buildChatContext(
          DEFAULT_SPORTS,
          slipForContext,
          controller.signal,
          oddsThreshold,
          includePeriods,
        );
        const apiMessages: ChatMessage[] = history.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        let first = true;
        const full = await streamChat({
          messages: apiMessages,
          context,
          imageDataUrl: image?.dataUrl,
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

        let picks = parsePicks(full, context.realOdds, propPool, gameMeta);
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
          const emittedPickLines = (full.match(/PICK:/gi) || []).length;
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
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: full + thresholdNote, picks };
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
              content: "Sorry — I couldn't reach the live data feed just now. Please try again.",
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
    [messages, slipForContext, streaming, scrollToEnd, attachedImage],
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
              (isWaiting || bubbleText.length > 0 || !!m.imageUri);
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
                    {m.imageUri ? (
                      <Image
                        source={{ uri: m.imageUri }}
                        style={{
                          width: 200,
                          height: 200,
                          borderRadius: 10,
                          marginBottom: bubbleText.length > 0 ? 8 : 0,
                        }}
                        contentFit="cover"
                      />
                    ) : null}
                    {isWaiting ? (
                      <ActivityIndicator color={colors.mutedForeground} size="small" />
                    ) : bubbleText.length > 0 ? (
                      <Text
                        selectable
                        style={{
                          color: m.role === "user" ? colors.primaryForeground : colors.foreground,
                          fontFamily: FONT.body,
                          fontSize: 14,
                          lineHeight: 21,
                        }}
                      >
                        {bubbleText}
                      </Text>
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
                    {m.picks!.map((p, j) => (
                      <PickCard key={`${i}-${j}`} pick={p} />
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
      {/* Attached-photo preview — shown above the input until sent or removed. */}
      {attachedImage ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <View style={{ alignSelf: "flex-start" }}>
            <Image
              source={{ uri: attachedImage.uri }}
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
              onPress={() => setAttachedImage(null)}
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
          disabled={streaming || pickingImage}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed || streaming ? 0.6 : 1,
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
          disabled={(!input.trim() && !attachedImage) || streaming}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor:
              (!input.trim() && !attachedImage) || streaming ? colors.card : colors.primary,
            borderWidth: (!input.trim() && !attachedImage) || streaming ? 1 : 0,
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
                !input.trim() && !attachedImage ? colors.mutedForeground : colors.primaryForeground
              }
            />
          )}
        </Pressable>
      </View>
      </KeyboardStickyView>
    </View>
  );
}
