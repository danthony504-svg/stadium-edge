import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { FONT } from "@/components/ui";
import { useBetSlip } from "@/context/BetSlipContext";
import { useColors } from "@/hooks/useColors";
import {
  buildChatContext,
  getPlayerHistory,
  getStatmuseGamelog,
  propPoolFromContext,
  searchPlayer,
  streamChat,
  type ChatMessage,
} from "@/lib/api";
import { DEFAULT_SPORTS } from "@/lib/sports";
import { parseStatLookup } from "@/lib/statLookup";

type UIMessage = {
  role: "user" | "assistant";
  content: string;
  picks?: ParsedPick[];
  statCard?: PlayerStatCardData;
  periodGameLog?: PeriodGameLogCardData;
};

type StatCardResult = { statCard?: PlayerStatCardData; periodGameLog?: PeriodGameLogCardData };

// Resolve a player/stat question into a REAL stat card. Returns null when the
// message isn't a stat lookup or no real player/data resolves — the caller then
// falls back to the AI chat path. Throws AbortError if cancelled. Never
// fabricates: every value comes from ESPN (player-history) or StatMuse's real
// results grid (statmuse-gamelog).
async function tryStatCard(text: string, signal: AbortSignal): Promise<StatCardResult | null> {
  const lookup = parseStatLookup(text);
  if (!lookup) return null;

  const sr = await searchPlayer(lookup.name, signal);
  const results = sr.results || [];
  if (!results.length) return null;
  // ESPN search is relevance-ranked; trust the top hit so historical/retired
  // queries resolve to the right athlete instead of being overridden by any
  // active player further down the list.
  const top = results[0];

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

const QUICK_PROMPTS = [
  "Build me a safe 3-leg parlay for tonight",
  "What's the best value bet on the board?",
  "Give me a 5-leg longshot parlay",
  "Which favorites are worth backing tonight?",
];

const CHAT_SEEN_KEY = "se_chat_seen";

const WELCOME_FIRST_TIME =
  "Welcome to Stadium Edge. I’m connected to live odds, live game data, and an AI brain built for sports analysis. Toggle PICK LIVE to load real-time matchups, then ask me anything — I factor in odds value, team form, coaching tendencies, injuries, and weather conditions to give you the sharpest possible take.\n\nTap 3-Leg, 6-Leg, 9-Leg, or 15-Leg to build a parlay that size, or just type what you want. Heads up: confidence compounds down with each leg — a 15-leg parlay is a true longshot.";

const WELCOME_RETURNING =
  "Stadium Edge is locked in. Tap 3-Leg, 6-Leg, 9-Leg, or 15-Leg — or just tell me what you want. Let’s build.";

export default function CoachScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { legs, setAiPicks } = useBetSlip();
  const params = useLocalSearchParams<{ prefill?: string; send?: string; ts?: string }>();
  const autoSentRef = useRef<string | null>(null);

  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [waiting, setWaiting] = useState(false);
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

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;
      setInput("");

      const history: UIMessage[] = [...messages, { role: "user", content: trimmed }];
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
        const card = await tryStatCard(trimmed, controller.signal);
        if (card) {
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { role: "assistant", content: "", ...card };
            return copy;
          });
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
        const context = await buildChatContext(DEFAULT_SPORTS, slipForContext, controller.signal);
        const apiMessages: ChatMessage[] = history.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        let first = true;
        const full = await streamChat({
          messages: apiMessages,
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

        const picks = parsePicks(full, context.realOdds, propPoolFromContext(context.realProps));
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: full, picks };
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
    [messages, slipForContext, streaming, scrollToEnd],
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
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
        bottomOffset={12}
      >
        <View style={{ gap: 14, paddingTop: 4 }}>
          {messages.map((m, i) => (
              <View key={i}>
                {m.statCard ? (
                  <PlayerStatCard data={m.statCard} />
                ) : m.periodGameLog ? (
                  <PeriodGameLogCard data={m.periodGameLog} />
                ) : (
                  <View
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
                    {m.role === "assistant" && m.content === "" && waiting ? (
                      <ActivityIndicator color={colors.mutedForeground} size="small" />
                    ) : (
                      <Text
                        style={{
                          color: m.role === "user" ? colors.primaryForeground : colors.foreground,
                          fontFamily: FONT.body,
                          fontSize: 14,
                          lineHeight: 21,
                        }}
                      >
                        {m.content}
                      </Text>
                    )}
                  </View>
                )}

                {m.picks && m.picks.length > 0 ? (
                  <View style={{ gap: 8, marginTop: 10 }}>
                    {m.picks.map((p, j) => (
                      <PickCard key={`${i}-${j}`} pick={p} />
                    ))}
                  </View>
                ) : null}
              </View>
            ))}

          {messages.length <= 1 ? (
            <View style={{ gap: 8, marginTop: 4 }}>
              {QUICK_PROMPTS.map((q) => (
                <Pressable
                  key={q}
                  onPress={() => send(q)}
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
                    {q}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          </View>
      </KeyboardAwareScrollViewCompat>

      {/* Composer */}
      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
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
        <TextInput
          value={input}
          onChangeText={setInput}
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
          disabled={!input.trim() || streaming}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: !input.trim() || streaming ? colors.card : colors.primary,
            borderWidth: !input.trim() || streaming ? 1 : 0,
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
              color={!input.trim() ? colors.mutedForeground : colors.primaryForeground}
            />
          )}
        </Pressable>
      </View>
      </KeyboardStickyView>
    </View>
  );
}
