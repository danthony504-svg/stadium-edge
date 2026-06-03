import { Feather } from "@expo/vector-icons";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { PickCard, parsePicks, type ParsedPick } from "@/components/PickCard";
import { EmptyState, FONT } from "@/components/ui";
import { useBetSlip } from "@/context/BetSlipContext";
import { useColors } from "@/hooks/useColors";
import { buildChatContext, streamChat, type ChatMessage } from "@/lib/api";
import { DEFAULT_SPORTS } from "@/lib/sports";

type UIMessage = {
  role: "user" | "assistant";
  content: string;
  picks?: ParsedPick[];
};

const QUICK_PROMPTS = [
  "Build me a safe 3-leg parlay for tonight",
  "What's the best value bet on the board?",
  "Give me a 5-leg longshot parlay",
  "Which favorites are worth backing tonight?",
];

export default function CoachScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { legs } = useBetSlip();
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

        const picks = parsePicks(full, context.realOdds);
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: full, picks };
          return copy;
        });
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
        {messages.length === 0 ? (
          <View>
            <EmptyState
              icon="message-circle"
              title="Ask your AI Coach anything"
              subtitle="Parlays, value bets, matchup reads — every suggestion is built only from real, current lines."
            />
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
          </View>
        ) : (
          <View style={{ gap: 14, paddingTop: 4 }}>
            {messages.map((m, i) => (
              <View key={i}>
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

                {m.picks && m.picks.length > 0 ? (
                  <View style={{ gap: 8, marginTop: 10 }}>
                    {m.picks.map((p, j) => (
                      <PickCard key={`${i}-${j}`} pick={p} />
                    ))}
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </KeyboardAwareScrollViewCompat>

      {/* Composer */}
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
    </View>
  );
}
