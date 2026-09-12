/**
 * Greenfield AI Coach — thin chat + hard-terminal session.
 *
 * Replaces the ~8k-line delivery god-file. One send → one session → one latch.
 * Parlay builds use board scan with an absolute UI budget; Q&A uses streamChat.
 * After latch the composer is always unlocked.
 */

import Feather from "@expo/vector-icons/Feather";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppHeader } from "@/components/AppHeader";
import { CoachBuildProgress } from "@/components/coach/CoachBuildProgress";
import { PickCard, parsePicks, type ParsedPick } from "@/components/PickCard";
import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { buildChatContext, streamChat } from "@/lib/api";
import { buildCoachParlay } from "@/lib/coach/buildParlay";
import { isParlayBuildAsk, resolveBuildLegTarget } from "@/lib/coach/parseAsk";
import {
  armCoachAbsoluteTerminal,
  beginCoachSession,
  coachPropLoadFailsafeMs,
  coachSessionIsTerminal,
  coachSessionShouldKeepBusy,
  coachShortfallNote,
  createCoachSession,
  latchCoachSession,
  resetCoachAbsoluteClock,
  resolveCoachOutcome,
} from "@/lib/coach/session";
import { takeCoachLaunch } from "@/lib/coachSilentLaunch";
import { DEFAULT_SPORTS } from "@/lib/sports";

type Role = "user" | "assistant";

type CoachMessage = {
  id: string;
  role: Role;
  text: string;
  picks?: ParsedPick[];
  building?: boolean;
  buildStatus?: string;
  requestedLegs?: number;
};

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function CoachScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<CoachMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Ask for a parlay, value bet, or matchup. Picks are grounded in tonight's real odds — never invented.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<FlatList<CoachMessage>>(null);
  const sendGenRef = useRef(0);
  const sessionRef = useRef(createCoachSession());
  const abortRef = useRef<AbortController | null>(null);

  const unlockComposer = useCallback(() => {
    setBusy(false);
  }, []);

  const patchAssistant = useCallback((id: string, patch: Partial<CoachMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const finishSession = useCallback(
    (
      assistantId: string,
      opts: {
        picks: ParsedPick[];
        text: string;
        requestedLegs: number;
        failed?: boolean;
      },
    ) => {
      const outcome = resolveCoachOutcome({
        pickCount: opts.picks.length,
        requestedLegs: opts.requestedLegs,
        failed: opts.failed,
      });
      latchCoachSession(sessionRef.current, outcome);
      // Prefer the build note when present — it carries prop-pool context.
      // Only synthesize a generic shortfall when the build returned no text.
      const shortfall =
        !opts.text.trim() && (outcome === "shortfall" || outcome === "empty")
          ? coachShortfallNote(opts.requestedLegs, opts.picks.length)
          : "";
      patchAssistant(assistantId, {
        building: false,
        buildStatus: undefined,
        picks: opts.picks,
        text: [shortfall, opts.text].filter(Boolean).join("\n\n"),
        requestedLegs: opts.requestedLegs || undefined,
      });
      unlockComposer();
    },
    [patchAssistant, unlockComposer],
  );

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;

      // Busy + open session: treat as stop. Busy + already latched: ignore.
      if (busy) {
        if (sessionRef.current.outcome === "open") {
          abortRef.current?.abort();
          latchCoachSession(sessionRef.current, "failed");
          unlockComposer();
        }
        return;
      }

      const sendGen = ++sendGenRef.current;
      const requestedLegs = resolveBuildLegTarget(text);
      beginCoachSession(sessionRef.current, {
        sendGen,
        requestedLegs,
      });
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      const userMsg: CoachMessage = { id: uid("u"), role: "user", text };
      const assistantId = uid("a");
      const assistantMsg: CoachMessage = {
        id: assistantId,
        role: "assistant",
        text: "",
        building: true,
        buildStatus: requestedLegs >= 3 ? "Starting board scan…" : "Thinking…",
        requestedLegs: requestedLegs || undefined,
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setDraft("");
      setBusy(true);

      const fireAbsoluteTerminal = () => {
        if (sendGenRef.current !== sendGen) return;
        abort.abort();
        setMessages((prev) => {
          const cur = prev.find((m) => m.id === assistantId);
          const picks = cur?.picks ?? [];
          finishSession(assistantId, {
            picks,
            text:
              cur?.text?.trim() ||
              (picks.length
                ? ""
                : "Hit the delivery budget before the board finished — composer unlocked."),
            requestedLegs,
          });
          return prev;
        });
      };

      try {
        if (isParlayBuildAsk(text) && requestedLegs >= 3) {
          // Prop-board prefetch can take a while — do not burn the scoring budget
          // during load (that latched "2 game totals" before props ran).
          let loadTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
            loadTimer = null;
            if (sendGenRef.current !== sendGen) return;
            if (coachSessionIsTerminal(sessionRef.current)) return;
            fireAbsoluteTerminal();
          }, coachPropLoadFailsafeMs());

          const result = await buildCoachParlay({
            requestedLegs,
            askText: text,
            signal: abort.signal,
            onStatus: (status) => {
              if (sendGenRef.current !== sendGen) return;
              patchAssistant(assistantId, { buildStatus: status });
            },
            onPartialPicks: (picks) => {
              if (sendGenRef.current !== sendGen) return;
              patchAssistant(assistantId, { picks: [...picks] });
            },
            onReadyToScan: () => {
              if (sendGenRef.current !== sendGen) return;
              if (loadTimer) {
                clearTimeout(loadTimer);
                loadTimer = null;
              }
              resetCoachAbsoluteClock(sessionRef.current);
              armCoachAbsoluteTerminal(sessionRef.current, fireAbsoluteTerminal);
            },
          });
          if (loadTimer) {
            clearTimeout(loadTimer);
            loadTimer = null;
          }
          if (sendGenRef.current !== sendGen) return;
          if (!coachSessionShouldKeepBusy(sessionRef.current)) return;
          finishSession(assistantId, {
            picks: result.picks,
            text: result.note,
            requestedLegs,
          });
          return;
        }

        armCoachAbsoluteTerminal(sessionRef.current, fireAbsoluteTerminal);
        patchAssistant(assistantId, { buildStatus: "Pulling live odds…" });
        const built = await buildChatContext(
          DEFAULT_SPORTS.slice(0, 6),
          [],
          abort.signal,
          null,
          false,
          text,
          null,
          0,
        );
        if (sendGenRef.current !== sendGen) return;
        patchAssistant(assistantId, { buildStatus: "Writing answer…" });
        let streamed = "";
        await streamChat({
          messages: [{ role: "user", content: text }],
          context: built.context,
          signal: abort.signal,
          onToken: (full) => {
            streamed = full;
            if (sendGenRef.current !== sendGen) return;
            patchAssistant(assistantId, { text: full, buildStatus: "Writing answer…" });
          },
        });
        if (sendGenRef.current !== sendGen) return;
        if (!coachSessionShouldKeepBusy(sessionRef.current)) return;
        const picks = parsePicks(
          streamed,
          built.context.realOdds ?? [],
          built.propPool ?? [],
          built.gameMeta ?? [],
        );
        finishSession(assistantId, {
          picks,
          text: picks.length ? "" : streamed.trim(),
          requestedLegs: 0,
        });
      } catch (err) {
        if (sendGenRef.current !== sendGen) return;
        if (abort.signal.aborted && sessionRef.current.outcome !== "open") return;
        const message =
          err instanceof Error && err.message
            ? err.message
            : "Something went wrong building that reply.";
        finishSession(assistantId, {
          picks: [],
          text: message,
          requestedLegs,
          failed: true,
        });
      }
    },
    [busy, finishSession, patchAssistant, unlockComposer],
  );

  useEffect(() => {
    const launch = takeCoachLaunch();
    if (launch?.freshThread) {
      setMessages([
        {
          id: "welcome",
          role: "assistant",
          text: "Ask for a parlay, value bet, or matchup. Picks are grounded in tonight's real odds — never invented.",
        },
      ]);
    }
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (sessionRef.current.outcome === "open") {
        latchCoachSession(sessionRef.current, "failed");
      }
    };
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AppHeader bottomGap={0}>
        <View style={{ paddingHorizontal: 16, paddingBottom: 10, gap: 4 }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 28 }}>
            AI Coach
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
            Picks grounded in tonight's real odds — never invented.
          </Text>
        </View>
      </AppHeader>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top + 8}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingBottom: 16, gap: 10 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => {
            if (item.role === "user") {
              return (
                <View style={{ paddingHorizontal: 16, alignItems: "flex-end" }}>
                  <View
                    style={{
                      maxWidth: "88%",
                      backgroundColor: colors.primary,
                      borderRadius: 16,
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                    }}
                  >
                    <Text style={{ color: "#fff", fontFamily: FONT.medium, fontSize: 15 }}>
                      {item.text}
                    </Text>
                  </View>
                </View>
              );
            }
            return (
              <View style={{ gap: 8 }}>
                {item.building ? (
                  <CoachBuildProgress
                    requestedLegs={item.requestedLegs ?? 0}
                    status={item.buildStatus || "Working…"}
                  />
                ) : null}
                {item.requestedLegs && item.requestedLegs >= 3 && !item.building ? (
                  <View style={{ paddingHorizontal: 16 }}>
                    <View
                      style={{
                        alignSelf: "flex-start",
                        backgroundColor: "rgba(59,130,246,0.15)",
                        borderColor: colors.primary,
                        borderWidth: 1,
                        borderRadius: 999,
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                      }}
                    >
                      <Text
                        style={{
                          color: colors.primary,
                          fontFamily: FONT.semibold,
                          fontSize: 12,
                        }}
                      >
                        {item.requestedLegs}-Leg parlay
                      </Text>
                    </View>
                  </View>
                ) : null}
                {item.text.trim() ? (
                  <View style={{ paddingHorizontal: 16 }}>
                    <Text
                      style={{
                        color: colors.foreground,
                        fontFamily: FONT.body,
                        fontSize: 15,
                        lineHeight: 22,
                      }}
                    >
                      {item.text.trim()}
                    </Text>
                  </View>
                ) : null}
                {item.picks?.map((pick, idx) => (
                  <View key={`${item.id}-pick-${idx}`} style={{ paddingHorizontal: 12 }}>
                    <PickCard pick={pick} />
                  </View>
                ))}
              </View>
            );
          }}
        />

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 12,
            paddingTop: 8,
            paddingBottom: Math.max(insets.bottom, 10),
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.background,
          }}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask for a parlay, value bet, matchup…"
            placeholderTextColor={colors.mutedForeground}
            editable={!busy}
            multiline
            style={{
              flex: 1,
              minHeight: 42,
              maxHeight: 120,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
              borderRadius: 22,
              paddingHorizontal: 14,
              paddingVertical: 10,
              color: colors.foreground,
              fontFamily: FONT.body,
              fontSize: 15,
            }}
            onSubmitEditing={() => void send(draft)}
          />
          <Pressable
            onPress={() => void send(draft)}
            disabled={!draft.trim() && !busy}
            style={({ pressed }) => ({
              width: 42,
              height: 42,
              borderRadius: 21,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: busy ? colors.card : colors.primary,
              opacity: pressed ? 0.8 : 1,
            })}
            accessibilityLabel={busy ? "Stop" : "Send"}
          >
            {busy ? (
              <Feather name="square" size={16} color={colors.foreground} />
            ) : (
              <Feather name="arrow-up" size={18} color="#fff" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
