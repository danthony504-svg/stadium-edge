/**
 * Greenfield AI Coach — thin chat + hard-terminal session.
 *
 * Replaces the ~8k-line delivery god-file. One send → one session → one latch.
 * Parlay builds use board scan with an absolute UI budget; Q&A uses streamChat.
 * Slip photos (max 3) go straight to the vision model for keep/change analysis.
 * After latch the composer is always unlocked.
 */

import Feather from "@expo/vector-icons/Feather";
import { Image } from "expo-image";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import {
  PickCard,
  gameSideFromPick,
  gameTotalFromPick,
  parsePicks,
  type ParsedPick,
} from "@/components/PickCard";
import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { buildChatContext, streamChat, type ChatContext, type PropPoolEntry } from "@/lib/api";
import { buildCoachParlay } from "@/lib/coach/buildParlay";
import { isParlayBuildAsk, resolveBuildLegTarget } from "@/lib/coach/parseAsk";
import {
  buildLiveCoachRecommendations,
  wantsLiveCoachAsk,
} from "@/lib/liveCoach";
import {
  armCoachAbsoluteTerminal,
  beginCoachSession,
  coachPropLoadFailsafeMs,
  coachSessionIsTerminal,
  coachSessionMayAcceptLatePicks,
  coachSessionShouldKeepBusy,
  coachShortfallNote,
  createCoachSession,
  latchCoachSession,
  resetCoachAbsoluteClock,
  resolveCoachOutcome,
  upgradeCoachSessionOutcome,
} from "@/lib/coach/session";
import {
  resolveCoachTerminalPicks,
  shouldPublishCoachTicketPicks,
} from "@/lib/coachTicketHold";
import {
  isSlipPhotoVisionOnly,
  MAX_COACH_IMAGES,
  wantsImproveSlip,
} from "@/lib/coachPhotoUpload";
import { rememberParlayBuild } from "@/lib/parlayVarietyMemory";
import { dedupePicksByMarketLadder } from "@/lib/marketLadderKey";
import { takeCoachLaunch } from "@/lib/coachSilentLaunch";
import { sanitizeCoachUserNote } from "@/lib/sanitizeCoachUserNote";
import { DEFAULT_SPORTS } from "@/lib/sports";
import { useRouter } from "expo-router";

type Role = "user" | "assistant";

type CoachMessage = {
  id: string;
  role: Role;
  text: string;
  picks?: ParsedPick[];
  building?: boolean;
  buildStatus?: string;
  requestedLegs?: number;
  /** Local preview URIs for photos the user attached to this bubble. */
  imageUris?: string[];
};

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function CoachScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [messages, setMessages] = useState<CoachMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Ask for a parlay, value bet, or matchup. Picks are grounded in tonight's real odds — never invented.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachedImages, setAttachedImages] = useState<{ uri: string; dataUrl: string }[]>([]);
  const [pickingImage, setPickingImage] = useState(false);
  const listRef = useRef<FlatList<CoachMessage>>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const sendGenRef = useRef(0);
  const pendingTicketPicksRef = useRef<ParsedPick[]>([]);
  /** Last slip photos sent — re-attached silently on "give me a better one". */
  const lastSlipImagesRef = useRef<string[]>([]);
  /** Mid-scan flush: 0-prop buffers mean props still pending (any sport). */
  const propsIncompleteForFlush = (_ask: string | null | undefined, picks: ParsedPick[]) =>
    !picks.some((p) => !!p.isProp);
  /** Ask text for the open session — terminal flush uses it for football prop-mix caps. */
  const sessionAskTextRef = useRef("");
  /** Pick count committed at last terminal latch — used for late budget upgrades. */
  const terminalShownPickCountRef = useRef(0);
  /** Active assistant bubble for the open session — used to flush held picks on stop. */
  const activeAssistantIdRef = useRef<string | null>(null);
  const sessionRef = useRef(createCoachSession());
  const abortRef = useRef<AbortController | null>(null);

  const unlockComposer = useCallback(() => {
    setBusy(false);
  }, []);

  /**
   * Open the photo library (up to 3). Downscale ≤1024px + JPEG 0.55 so cellular
   * uploads stay under the API body cap (see slip-photo cellular fix).
   */
  const pickImage = useCallback(async () => {
    if (busy || pickingImage) return;
    const remaining = MAX_COACH_IMAGES - attachedImages.length;
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
      const picked = result.assets.slice(0, remaining);
      const processed: { uri: string; dataUrl: string }[] = [];
      for (const asset of picked) {
        if (!asset.uri) continue;
        const actions =
          asset.width && asset.width > 1024 ? [{ resize: { width: 1024 } }] : [];
        const out = await ImageManipulator.manipulateAsync(asset.uri, actions, {
          compress: 0.55,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        });
        if (!out.base64) continue;
        processed.push({
          uri: out.uri,
          dataUrl: `data:image/jpeg;base64,${out.base64}`,
        });
      }
      if (processed.length) {
        setAttachedImages((prev) =>
          [...prev, ...processed].slice(0, MAX_COACH_IMAGES),
        );
      }
    } catch {
      /* leave existing attachments */
    } finally {
      setPickingImage(false);
    }
  }, [busy, pickingImage, attachedImages.length]);

  /**
   * Tap a Coach pick card → real stats sheet (prop game log / team matchup).
   * Fail-closed: no handler when we can't ground a sheet. Does not touch
   * build/selection — navigation only.
   */
  const statsHandlerFor = useCallback(
    (p: ParsedPick): (() => void) | undefined => {
      if (p.isProp) {
        if (!p.player && !p.athleteId) return undefined;
        return () => {
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
              teamAbbr: p.teamAbbr ?? "",
              pick: p.pick,
            },
          });
        };
      }
      if (!p.sport) return undefined;
      const total = gameTotalFromPick(p);
      if (total) {
        return () => {
          router.push({
            pathname: "/team-pick/[id]",
            params: {
              id: `${total.away}-${total.home}-total`,
              kind: "total",
              team: total.away,
              opp: total.home,
              isHome: "0",
              sport: p.sport ?? "",
              market: p.market,
              line: total.line != null ? String(total.line) : "",
              odds: String(p.odds),
              game: p.game,
              startsAt: p.startsAt ?? "",
              pick: p.pick,
              side: total.side,
            },
          });
        };
      }
      const side = gameSideFromPick(p);
      if (!side) return undefined;
      return () => {
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
      };
    },
    [router],
  );

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
        /** Absolute flush while props still scoring — honest shortfall, not quality bar. */
        propsPending?: boolean;
      },
    ) => {
      const picks = dedupePicksByMarketLadder(opts.picks);
      const outcome = resolveCoachOutcome({
        pickCount: picks.length,
        requestedLegs: opts.requestedLegs,
        failed: opts.failed,
      });
      latchCoachSession(sessionRef.current, outcome);
      terminalShownPickCountRef.current = picks.length;
      if (picks.length > 0 && outcome !== "failed") {
        rememberParlayBuild(picks);
      }
      // Prefer the build note when present — it carries prop-pool context.
      // Only synthesize a generic shortfall when the build returned no text.
      // Strip any leaked `[CODE: detail]` machine traces before the bubble paints.
      const shortfall =
        !opts.text.trim() && (outcome === "shortfall" || outcome === "empty")
          ? coachShortfallNote(opts.requestedLegs, picks.length, {
              propsPending: opts.propsPending,
            })
          : "";
      patchAssistant(assistantId, {
        building: false,
        buildStatus: undefined,
        picks,
        text: sanitizeCoachUserNote(
          [shortfall, opts.text].filter(Boolean).join("\n\n"),
        ),
        requestedLegs: opts.requestedLegs || undefined,
      });
      unlockComposer();
    },
    [patchAssistant, unlockComposer],
  );

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      const images = attachedImages;
      if (!text && !images.length) return;

      // Busy + open session: treat as stop. Busy + already latched: ignore.
      // Holding cards mid-build means stop must flush the buffer or the ticket
      // stays blank forever (building spinner with zero cards).
      if (busy) {
        if (sessionRef.current.outcome === "open") {
          abortRef.current?.abort();
          const assistantId = activeAssistantIdRef.current;
          const legs = sessionRef.current.requestedLegs;
          const buffered = pendingTicketPicksRef.current;
          const picks = resolveCoachTerminalPicks({
            bufferedPicks: buffered,
            messagePicks: null,
            askText: sessionAskTextRef.current,
            requestedLegs: legs,
            propPhaseIncomplete: propsIncompleteForFlush(
              sessionAskTextRef.current,
              buffered,
            ),
          });
          pendingTicketPicksRef.current = [];
          if (assistantId) {
            finishSession(assistantId, {
              picks,
              text: picks.length
                ? "Stopped — showing every pick that had cleared."
                : "Stopped before the ticket finished.",
              requestedLegs: legs,
              failed: true,
            });
          } else {
            latchCoachSession(sessionRef.current, "failed");
            unlockComposer();
          }
        }
        return;
      }

      // Resolve outgoing images: fresh attachments, or silent re-attach on
      // "give me a better one" so the model can re-read the same slip.
      let outgoingImageDataUrls: string[] | undefined;
      if (images.length) {
        outgoingImageDataUrls = images.map((im) => im.dataUrl);
        lastSlipImagesRef.current = outgoingImageDataUrls;
      } else if (wantsImproveSlip(text) && lastSlipImagesRef.current.length) {
        outgoingImageDataUrls = lastSlipImagesRef.current;
      }
      const hasOutgoingImages = !!outgoingImageDataUrls?.length;
      const previewUris = images.length ? images.map((im) => im.uri) : undefined;

      const sendGen = ++sendGenRef.current;
      const liveAsk = wantsLiveCoachAsk(text);
      const requestedLegs = resolveBuildLegTarget(text);
      // Live Coach asks never enter pregame buildParlay — even when they look like N-pick counts.
      const parlayBuild =
        !liveAsk && isParlayBuildAsk(text) && requestedLegs >= 3 && !hasOutgoingImages;
      sessionAskTextRef.current = text;
      beginCoachSession(sessionRef.current, {
        sendGen,
        requestedLegs: liveAsk ? requestedLegs || 3 : parlayBuild ? requestedLegs : 0,
      });
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      const userMsg: CoachMessage = {
        id: uid("u"),
        role: "user",
        text: text || (hasOutgoingImages ? "Analyze this ticket" : ""),
        imageUris: previewUris,
      };
      const assistantId = uid("a");
      activeAssistantIdRef.current = assistantId;
      const assistantMsg: CoachMessage = {
        id: assistantId,
        role: "assistant",
        text: "",
        building: true,
        buildStatus: hasOutgoingImages
          ? "Reading your ticket photo…"
          : liveAsk
            ? "Scanning LIVE board…"
            : parlayBuild
              ? "Starting board scan…"
              : "Thinking…",
        requestedLegs: liveAsk || parlayBuild ? requestedLegs || undefined : undefined,
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setDraft("");
      setAttachedImages([]);
      pendingTicketPicksRef.current = [];
      terminalShownPickCountRef.current = 0;
      setBusy(true);

      const fireAbsoluteTerminal = () => {
        if (sendGenRef.current !== sendGen) return;
        if (coachSessionIsTerminal(sessionRef.current)) return;
        abort.abort();
        // Do NOT call finishSession/setMessages inside a setMessages updater —
        // React can drop the nested update, leaving building:true forever while
        // the composer unlocks (stuck "Scoring ticket… N legs" card).
        const buffered = pendingTicketPicksRef.current;
        const ask = sessionAskTextRef.current || text;
        const propsPending = propsIncompleteForFlush(ask, buffered);
        const picks = resolveCoachTerminalPicks({
          bufferedPicks: buffered,
          messagePicks: null,
          askText: ask,
          requestedLegs,
          propPhaseIncomplete: propsPending,
        });
        finishSession(assistantId, {
          picks,
          text: picks.length
            ? ""
            : "Hit the delivery budget before the board finished — composer unlocked.",
          requestedLegs,
          propsPending,
        });
      };

      try {
        // ---- Slip photo vision path (max 3) — analyze keep/change or improve ----
        if (hasOutgoingImages) {
          armCoachAbsoluteTerminal(sessionRef.current, fireAbsoluteTerminal);
          const visionOnly = isSlipPhotoVisionOnly({
            hasImages: true,
            text,
          });
          const askText =
            text ||
            "Analyze this ticket — what should I keep and what should I change?";

          let streamContext: ChatContext;
          let propPool: import("@/lib/api").PropPoolEntry[] = [];
          if (visionOnly) {
            // Skip 30s+ odds fan-out so cellular opens /chat before connect-stall.
            streamContext = {
              selectedSports: [],
              currentSlip: [],
              realGames: [],
              realOdds: [],
              realProps: [],
            };
            patchAssistant(assistantId, {
              buildStatus: "Reading the slip — keep vs change…",
            });
          } else {
            patchAssistant(assistantId, { buildStatus: "Pulling live odds to improve…" });
            const built = await buildChatContext(
              DEFAULT_SPORTS.slice(0, 6),
              [],
              abort.signal,
              null,
              false,
              askText,
              null,
              0,
            );
            if (sendGenRef.current !== sendGen) return;
            streamContext = built.context;
            propPool = built.propPool ?? [];
          }

          patchAssistant(assistantId, { buildStatus: "Writing analysis…" });
          let streamed = "";
          await streamChat({
            messages: [{ role: "user", content: askText }],
            context: streamContext,
            signal: abort.signal,
            imageDataUrls: outgoingImageDataUrls,
            firstTokenMs: 90_000,
            onToken: (full) => {
              streamed = full;
              if (sendGenRef.current !== sendGen) return;
              patchAssistant(assistantId, {
                text: full,
                buildStatus: "Writing analysis…",
              });
            },
          });
          if (sendGenRef.current !== sendGen) return;
          if (!coachSessionShouldKeepBusy(sessionRef.current)) return;

          // Improve-from-photo may emit PICK lines; parse when odds were loaded.
          let picks: ParsedPick[] = [];
          if (!visionOnly && streamed.trim()) {
            picks = parsePicks(
              streamed,
              streamContext.realOdds ?? [],
              propPool,
              [],
            );
          }
          finishSession(assistantId, {
            picks,
            text: picks.length ? "" : streamed.trim(),
            requestedLegs: picks.length || 0,
          });
          return;
        }

        // ---- Live Coach Phase 2A (NBA/WNBA live mains only) ----
        // Isolated from buildParlay / pregame Monte Carlo. Never lowers quality to fill.
        if (liveAsk) {
          armCoachAbsoluteTerminal(sessionRef.current, fireAbsoluteTerminal);
          patchAssistant(assistantId, { buildStatus: "Scanning LIVE NBA/WNBA board…" });
          const liveResult = await buildLiveCoachRecommendations({
            askText: text,
            signal: abort.signal,
            onStatus: (status) => {
              if (sendGenRef.current !== sendGen) return;
              patchAssistant(assistantId, { buildStatus: status });
            },
          });
          if (sendGenRef.current !== sendGen) return;
          if (!coachSessionShouldKeepBusy(sessionRef.current)) return;
          const liveLegs = liveResult.intent.count || requestedLegs || 3;
          finishSession(assistantId, {
            picks: liveResult.picks,
            text: sanitizeCoachUserNote(liveResult.note),
            requestedLegs: liveLegs,
          });
          return;
        }

        if (parlayBuild) {
          // Prop-board prefetch can take a while — do not burn the scoring budget
          // during load (that latched "2 game totals" before props ran).
          let loadTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
            loadTimer = null;
            if (sendGenRef.current !== sendGen) return;
            if (coachSessionIsTerminal(sessionRef.current)) return;
            fireAbsoluteTerminal();
          }, coachPropLoadFailsafeMs(requestedLegs));

          const priorUserTexts = messagesRef.current
            .filter((m) => m.role === "user")
            .map((m) => m.text)
            .filter(Boolean);
          const result = await buildCoachParlay({
            requestedLegs,
            askText: text,
            priorUserTexts,
            signal: abort.signal,
            onStatus: (status) => {
              if (sendGenRef.current !== sendGen) return;
              patchAssistant(assistantId, { buildStatus: status });
            },
            onPartialPicks: (picks) => {
              if (sendGenRef.current !== sendGen) return;
              // Buffer only — do not paint cards mid-build (trickle). Status still updates.
              pendingTicketPicksRef.current = [...picks];
              // Belts: if scoring started without onReadyToScan, still arm the wall clock.
              if (
                sessionRef.current.outcome === "open" &&
                !sessionRef.current.absoluteTimer
              ) {
                armCoachAbsoluteTerminal(sessionRef.current, fireAbsoluteTerminal);
              }
              if (shouldPublishCoachTicketPicks("building")) {
                patchAssistant(assistantId, { picks: [...picks] });
              }
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
          // Prefer the finished ticket; if it somehow lands empty, flush the
          // buffer so holding cards mid-build can never hang as a blank ticket.
          const ask = sessionAskTextRef.current || text;
          const buffered = pendingTicketPicksRef.current;
          const picks =
            result.picks.length > 0
              ? result.picks
              : resolveCoachTerminalPicks({
                  bufferedPicks: buffered,
                  messagePicks: null,
                  askText: ask,
                  requestedLegs,
                  // Empty result mid-flight: hold seats if buffer has no props yet.
                  propPhaseIncomplete: propsIncompleteForFlush(ask, buffered),
                });
          pendingTicketPicksRef.current = [];

          // Budget may have already latched empty/shortfall while the scan was
          // still finishing. Accept a better late ticket without re-busying.
          if (!coachSessionShouldKeepBusy(sessionRef.current)) {
            if (
              coachSessionMayAcceptLatePicks(sessionRef.current, {
                latePickCount: picks.length,
                shownPickCount: terminalShownPickCountRef.current,
              })
            ) {
              const outcome = resolveCoachOutcome({
                pickCount: picks.length,
                requestedLegs,
              });
              upgradeCoachSessionOutcome(sessionRef.current, outcome);
              terminalShownPickCountRef.current = picks.length;
              patchAssistant(assistantId, {
                building: false,
                buildStatus: undefined,
                picks,
                // Clear the empty-budget copy once a real ticket lands.
                text: sanitizeCoachUserNote(result.note),
                requestedLegs: requestedLegs || undefined,
              });
              unlockComposer();
            }
            return;
          }

          finishSession(assistantId, {
            picks,
            text: sanitizeCoachUserNote(result.note),
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
        // Stop already flushed held picks via finishSession — do not blank them.
        if (abort.signal.aborted && sessionRef.current.outcome !== "open") return;
        const message =
          err instanceof Error && err.message
            ? err.message
            : "Something went wrong building that reply.";
        const ask = sessionAskTextRef.current || text;
        const buffered = pendingTicketPicksRef.current;
        const propsPending = propsIncompleteForFlush(ask, buffered);
        const picks = resolveCoachTerminalPicks({
          bufferedPicks: buffered,
          messagePicks: null,
          askText: ask,
          requestedLegs,
          propPhaseIncomplete: propsPending,
        });
        pendingTicketPicksRef.current = [];
        finishSession(assistantId, {
          picks,
          text: message,
          requestedLegs,
          failed: true,
          propsPending,
        });
      }
    },
    [attachedImages, busy, finishSession, patchAssistant, unlockComposer],
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
                <View style={{ paddingHorizontal: 16, alignItems: "flex-end", gap: 8 }}>
                  {item.imageUris?.length ? (
                    <View
                      style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: 8,
                        justifyContent: "flex-end",
                        maxWidth: "88%",
                      }}
                    >
                      {item.imageUris.map((uri, idx) => (
                        <Image
                          key={`${item.id}-img-${idx}`}
                          source={{ uri }}
                          style={{
                            width: 96,
                            height: 96,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: colors.border,
                          }}
                          contentFit="cover"
                        />
                      ))}
                    </View>
                  ) : null}
                  {item.text.trim() ? (
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
                  ) : null}
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
                    <PickCard pick={pick} onPress={statsHandlerFor(pick)} />
                  </View>
                ))}
              </View>
            );
          }}
        />

        {/* Attached-photo previews — up to 3, above the composer until sent. */}
        {attachedImages.length ? (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 12,
              paddingHorizontal: 12,
              paddingTop: 8,
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
                  onPress={() =>
                    setAttachedImages((prev) => prev.filter((_, i) => i !== idx))
                  }
                  hitSlop={8}
                  accessibilityLabel="Remove photo"
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
          <Pressable
            onPress={() => void pickImage()}
            disabled={busy || pickingImage || attachedImages.length >= MAX_COACH_IMAGES}
            accessibilityLabel="Upload ticket photo"
            style={({ pressed }) => ({
              width: 42,
              height: 42,
              borderRadius: 21,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              opacity:
                pressed || busy || attachedImages.length >= MAX_COACH_IMAGES ? 0.6 : 1,
            })}
          >
            {pickingImage ? (
              <ActivityIndicator color={colors.mutedForeground} size="small" />
            ) : (
              <Feather name="image" size={20} color={colors.mutedForeground} />
            )}
          </Pressable>
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
            disabled={(!draft.trim() && !attachedImages.length && !busy) || pickingImage}
            style={({ pressed }) => ({
              width: 42,
              height: 42,
              borderRadius: 21,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor:
                busy || draft.trim() || attachedImages.length
                  ? busy
                    ? colors.card
                    : colors.primary
                  : colors.card,
              borderWidth: busy || draft.trim() || attachedImages.length ? 0 : 1,
              borderColor: colors.border,
              opacity: pressed ? 0.8 : 1,
            })}
            accessibilityLabel={busy ? "Stop" : "Send"}
          >
            {busy ? (
              <Feather name="square" size={16} color={colors.foreground} />
            ) : (
              <Feather
                name="arrow-up"
                size={18}
                color={
                  draft.trim() || attachedImages.length
                    ? "#fff"
                    : colors.mutedForeground
                }
              />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
