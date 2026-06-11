import { Feather } from "@expo/vector-icons";
import { useQueries } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { enrichPickMeta, gameSideFromPick, PickCard, type ParsedPick } from "@/components/PickCard";
import { Badge, EmptyState, FONT, PrimaryButton, SectionHeader } from "@/components/ui";
import {
  useBetSlip,
  type BetResult,
  type Leg,
  type LegResult,
  type SavedSlip,
} from "@/context/BetSlipContext";
import { useColors } from "@/hooks/useColors";
import {
  buildGameMeta,
  getGames,
  gradeBets,
  propMarketKeyForLabel,
  searchPlayer,
  type EspnGame,
  type GradeLegInput,
  type GradeLegResult,
} from "@/lib/api";
import { formatAmerican, parlayAmerican, parlayImplied, payout } from "@/lib/format";
import { isGameLevelMarket, parsePropLeg } from "@/lib/propLegParse";
import { saveSlipToPhotos } from "@/lib/slipImage";

// A game is considered "over" once it has been live longer than any realistic
// game runs. Generous so we never clear a slip whose game is still in play.
const GAME_OVER_BUFFER_MS = 6 * 3600_000;

// How long after a slip's last game starts we stop waiting for full grading and
// archive whatever we have. StatMuse player-stat logs can lag a few hours after
// a game ends, so we re-attempt grading on each feed refresh while the game is
// recent; once it's this old the data source has settled (or the game has
// dropped out of ESPN's window) and any still-ungraded legs are archived as
// "ungraded" — kept for the record but excluded from performance stats.
const FORCE_ARCHIVE_MS = 40 * 3600_000;

// Once a saved slip is at least this old, its games are certain to have finished
// (slips are made within hours of game time) AND have likely dropped out of
// ESPN's live scoreboard window (yesterday → +7d). Past this age, a leg whose
// game can no longer be found in the live feed is treated as "over" so the
// server grader — which settles against StatMuse logs / historical finals, not
// the live feed — still runs. Generous so an early-saved slip for a future game
// (still in the live feed) is never wrongly forced over.
const STALE_SLIP_MS = 24 * 3600_000;

const teamNick = (s: string) =>
  (s || "").trim().split(/\s+/).filter(Boolean).pop()?.toLowerCase() || "";

// Split a leg's game label ("Away @ Home" / "Away vs Home") into its two team
// nicknames so it can be matched against the live ESPN feed.
function gameTeamNicks(label: string): [string, string] | null {
  const parts = (label || "").split(/\s+@\s+|\s+vs\.?\s+|\s+at\s+/i);
  if (parts.length !== 2) return null;
  return [teamNick(parts[0]), teamNick(parts[1])];
}

// Whether tapping a leg can open a stats sheet: props need a parseable player
// (and a sport); game-level legs need to name a single team (gameSideFromPick is
// null for totals / ambiguous picks). Mirrors the AI-recommended card rule.
function legOpenable(leg: Leg): boolean {
  const sport = leg.sport ?? "";
  if (!sport) return false;
  if (!isGameLevelMarket(leg.market)) return parsePropLeg(leg) != null;
  return (
    gameSideFromPick({
      game: leg.game,
      market: leg.market,
      pick: leg.pick,
      odds: leg.odds,
      sport,
    }) != null
  );
}

// Build a resolver that classifies a leg's game against the live feed:
//   "over"    — confirmed finished (Final/post) or started past the buffer
//   "live"    — found but still upcoming / in progress
//   "unknown" — couldn't be resolved to exactly one game (don't act on it)
// Matching is scoped to the leg's own sport and requires a UNIQUE fixture: if
// zero or multiple games match (cross-sport nickname collision, doubleheader),
// we return "unknown" so the slip is never deleted on an ambiguous match.
// Resolve a leg's game label to the UNIQUE matching fixture in the live feed,
// scoped to the leg's sport. Returns null on zero/multiple matches so callers
// never act on an ambiguous game (cross-sport collision, doubleheader).
function legGameMatch(games: EspnGame[], label: string, sport?: string): EspnGame | null {
  const teams = gameTeamNicks(label);
  if (!teams) return null;
  const [a, b] = teams;
  if (!a || !b || a === b) return null;
  const candidates = games.filter((g) => {
    if (sport && g.sport && g.sport !== sport) return false;
    const ga = teamNick(g.awayTeam || "");
    const gh = teamNick(g.homeTeam || "");
    return (ga === a && gh === b) || (ga === b && gh === a);
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function legGameStatus(games: EspnGame[]) {
  return (
    label: string,
    sport?: string,
    slipCreatedAt?: number,
  ): "over" | "live" | "unknown" => {
    const match = legGameMatch(games, label, sport);
    if (!match) {
      // Game has aged out of ESPN's live window. If its slip is old enough that
      // the game must already be finished, treat it as "over" so the grader
      // still runs (it fail-closes to "ungraded" for anything it can't confirm,
      // so we never invent a result). Otherwise leave it unknown.
      if (
        slipCreatedAt !== undefined &&
        Date.now() - slipCreatedAt > STALE_SLIP_MS
      )
        return "over";
      return "unknown";
    }
    const finished = match.state === "post" || /final/i.test(match.status || "");
    if (finished) return "over";
    const t = Date.parse(match.startsAt);
    if (Number.isFinite(t) && Date.now() > t + GAME_OVER_BUFFER_MS) return "over";
    return "live";
  };
}

// Per-leg display state on a saved slip. "win"/"loss"/"push"/"ungraded" come
// from the server grader (real results, never invented); "pending" means the
// leg's game hasn't finished yet; "grading" means the game is over but the
// grader result hasn't loaded for this card yet.
type LegDisplayStatus =
  | "win"
  | "loss"
  | "push"
  | "ungraded"
  | "pending"
  | "grading";

const LEG_STATUS_ICON = {
  win: "check-circle",
  loss: "x-circle",
  push: "minus-circle",
  ungraded: "help-circle",
  grading: "loader",
  pending: "clock",
} as const satisfies Record<
  LegDisplayStatus,
  ComponentProps<typeof Feather>["name"]
>;

function legStatusColor(
  s: LegDisplayStatus,
  colors: ReturnType<typeof useColors>,
): string {
  if (s === "win") return colors.success;
  if (s === "loss") return colors.destructive;
  return colors.mutedForeground;
}

function LegRow({
  leg,
  onRemove,
  onPress,
  status,
}: {
  leg: Leg;
  onRemove?: () => void;
  onPress?: () => void;
  status?: LegDisplayStatus;
}) {
  const colors = useColors();
  const rowStyle = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  };
  const inner = (
    <>
      {status ? (
        <Feather
          name={LEG_STATUS_ICON[status]}
          size={16}
          color={legStatusColor(status, colors)}
        />
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
          {leg.pick}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, marginTop: 2 }}>
          {leg.market} · {leg.game}
        </Text>
      </View>
      <Text style={{ color: colors.accent, fontFamily: FONT.bold, fontSize: 14 }}>
        {formatAmerican(leg.odds)}
      </Text>
      {onPress ? (
        <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
      ) : null}
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={8} style={{ padding: 4 }}>
          <Feather name="x" size={18} color={colors.mutedForeground} />
        </Pressable>
      ) : null}
    </>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => ({ ...rowStyle, opacity: pressed ? 0.6 : 1 })}>
        {inner}
      </Pressable>
    );
  }
  return <View style={rowStyle}>{inner}</View>;
}


function SavedSlipCard({
  slip,
  onDelete,
  onOpenLeg,
  allGames,
  gradeResults,
}: {
  slip: SavedSlip;
  onDelete: () => void;
  onOpenLeg?: (leg: Leg) => void;
  allGames: EspnGame[];
  gradeResults?: GradeLegResult[];
}) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const [savingImage, setSavingImage] = useState(false);
  const ret = payout(slip.stake, slip.combinedOdds);

  // Resolve a real, never-invented status for each leg: game finished? grader
  // result? — so the card can show a settled/pending summary and per-leg ✓/✗
  // while the slip is still waiting on its remaining games to finish.
  const legStatuses = useMemo<LegDisplayStatus[]>(() => {
    const resolve = legGameStatus(allGames);
    const byIndex = new Map((gradeResults ?? []).map((r) => [r.index, r]));
    return slip.legs.map((l, i) => {
      if (resolve(l.game, l.sport, slip.createdAt) !== "over") return "pending";
      const r = byIndex.get(i);
      return r ? r.result : "grading";
    });
  }, [allGames, gradeResults, slip.legs, slip.createdAt]);

  const total = slip.legs.length;
  const pendingCount = legStatuses.filter((s) => s === "pending").length;
  const settledCount = total - pendingCount;
  const anyLoss = legStatuses.includes("loss");
  // Every leg fully settled with no loss: a win only if at least one leg won
  // (the rest pushing), an all-push if every leg pushed. A leftover "ungraded"
  // leg leaves the parlay short of a clean result, so it stays in the neutral
  // "settled count" form rather than claiming a win.
  const settledNoLoss = pendingCount === 0 && total > 0 && !anyLoss;
  const allPush = settledNoLoss && legStatuses.every((s) => s === "push");
  const allWon =
    settledNoLoss &&
    legStatuses.some((s) => s === "win") &&
    legStatuses.every((s) => s === "win" || s === "push");

  // A single confirmed losing leg sinks the whole parlay — surface that even
  // while other legs are still pending (it's already determinative).
  const summaryText = anyLoss
    ? pendingCount > 0
      ? `Parlay lost · ${pendingCount} still pending`
      : "Parlay lost"
    : allWon
      ? "Parlay won"
      : allPush
        ? "Parlay pushed"
        : pendingCount > 0
          ? `${settledCount}/${total} settled · ${pendingCount} pending`
          : `${settledCount}/${total} settled`;
  const summaryColor = anyLoss
    ? colors.destructive
    : allWon
      ? colors.success
      : colors.mutedForeground;
  const summaryIcon: ComponentProps<typeof Feather>["name"] = anyLoss
    ? "x-circle"
    : allWon
      ? "check-circle"
      : allPush
        ? "minus-circle"
        : pendingCount > 0
          ? "clock"
          : "help-circle";

  const onSaveToPhotos = async () => {
    if (savingImage || slip.legs.length === 0) return;
    setSavingImage(true);
    Haptics.selectionAsync();
    const result = await saveSlipToPhotos(slip.legs, slip.stake);
    setSavingImage(false);
    if (result.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Saved", "Your bet slip was saved to Photos.");
    } else if (result.reason === "permission") {
      Alert.alert(
        "Photos access needed",
        "Enable photo access for Stadium Edge in Settings to save your slip.",
      );
    } else {
      Alert.alert("Couldn't save", "Something went wrong saving your slip. Try again.");
    }
  };

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: colors.radius,
        padding: 14,
      }}
    >
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Badge label={`${slip.legs.length} LEG`} tone="primary" />
          <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 15 }}>
            {formatAmerican(slip.combinedOdds)}
          </Text>
        </View>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.mutedForeground} />
      </Pressable>

      <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, marginTop: 6 }}>
        ${slip.stake.toFixed(0)} → ${ret.toFixed(2)} · {new Date(slip.createdAt).toLocaleDateString()}
      </Text>

      {total > 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
          <Feather name={summaryIcon} size={13} color={summaryColor} />
          <Text style={{ color: summaryColor, fontFamily: FONT.semibold, fontSize: 12 }}>
            {summaryText}
          </Text>
        </View>
      ) : null}

      {open ? (
        <View style={{ marginTop: 8 }}>
          {slip.legs.map((l, i) => (
            <LegRow
              key={l.id}
              leg={l}
              status={legStatuses[i]}
              onPress={onOpenLeg && legOpenable(l) ? () => onOpenLeg(l) : undefined}
            />
          ))}
          <Pressable
            onPress={onSaveToPhotos}
            disabled={savingImage}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginTop: 12,
              paddingVertical: 10,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              opacity: savingImage ? 0.6 : pressed ? 0.85 : 1,
            })}
          >
            <Feather
              name={savingImage ? "loader" : "download"}
              size={15}
              color={colors.foreground}
            />
            <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 13 }}>
              {savingImage ? "Saving to Photos…" : "Save to Photos"}
            </Text>
          </Pressable>
          <Pressable
            onPress={onDelete}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              marginTop: 10,
              paddingVertical: 10,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.border,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Feather name="trash-2" size={15} color={colors.destructive} />
            <Text style={{ color: colors.destructive, fontFamily: FONT.semibold, fontSize: 13 }}>
              Delete slip
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export default function SlipScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    legs,
    savedSlips,
    stake,
    setStake,
    removeLeg,
    clearLegs,
    saveCurrentSlip,
    deleteSlip,
    settleSlips,
    aiPicks,
  } = useBetSlip();
  const [savingImage, setSavingImage] = useState(false);

  const onSaveToPhotos = async () => {
    if (savingImage || legs.length === 0) return;
    setSavingImage(true);
    Haptics.selectionAsync();
    const result = await saveSlipToPhotos(legs, stake);
    setSavingImage(false);
    if (result.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Saved", "Your bet slip was saved to Photos.");
    } else if (result.reason === "permission") {
      Alert.alert(
        "Photos access needed",
        "Enable photo access for Stadium Edge in Settings to save your slip.",
      );
    } else {
      Alert.alert("Couldn't save", "Something went wrong saving your slip. Try again.");
    }
  };

  const combined = parlayAmerican(legs.map((l) => l.odds));
  // "To win" is profit only — the winnings on top of the stake, NOT the total
  // return. payout() includes the stake, so subtract it back out.
  const toWin = payout(stake, combined) - stake;
  const implied = parlayImplied(legs.map((l) => l.odds));

  // aiPicks is an in-memory store that can predate the parser that attaches team
  // logos (e.g. after a code change while the app is open). Re-resolve each
  // pick's logos/codes here from a fresh ESPN games fetch so cards always show
  // the real matchup/team art without forcing the user to regenerate. Real data
  // only — enrichPickMeta is non-destructive and never invents anything.
  // Fetch ESPN games for every sport referenced by either the AI picks OR the
  // saved slips. The same feed powers two things: re-resolving AI pick art, and
  // detecting which saved slips are fully finished so they can auto-clear.
  const neededSports = useMemo(() => {
    const set = new Set<string>();
    aiPicks.forEach((p) => p.sport && set.add(p.sport));
    savedSlips.forEach((s) => s.legs.forEach((l) => l.sport && set.add(l.sport)));
    return Array.from(set);
  }, [aiPicks, savedSlips]);
  const gamesQueries = useQueries({
    queries: neededSports.map((sport) => ({
      queryKey: ["games", sport],
      queryFn: ({ signal }: { signal?: AbortSignal }) => getGames(sport, signal),
      staleTime: 60_000,
    })),
  });
  const gamesKey = gamesQueries.map((q) => q.dataUpdatedAt).join("|");
  const allGames = useMemo(
    () => gamesQueries.flatMap((q) => q.data ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gamesKey],
  );
  const enrichedAiPicks = useMemo(() => {
    const gameMeta = buildGameMeta(allGames);
    if (gameMeta.length === 0) return aiPicks;
    return aiPicks.map((p) => enrichPickMeta(p, gameMeta));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiPicks, gamesKey]);

  // Display-only grading for saved slips that have at least one FINISHED game, so
  // each card can show real per-leg ✓/✗ and a settled/pending summary while the
  // slip is still waiting on its remaining games. The archive effect below still
  // owns committing fully-settled slips to the Model Report; this reuses the same
  // server grader (which fail-closes to "ungraded" — never an invented W/L). The
  // query key includes which legs are over so it re-grades as more games finish.
  const slipGradeQueries = useQueries({
    queries: savedSlips.map((s) => {
      const resolve = legGameStatus(allGames);
      const overIdx = s.legs
        .map((l, i) => (resolve(l.game, l.sport, s.createdAt) === "over" ? i : -1))
        .filter((i) => i >= 0);
      return {
        queryKey: ["saved-slip-grade", s.id, overIdx.join(",")],
        enabled: overIdx.length > 0,
        staleTime: 5 * 60_000,
        queryFn: ({ signal }: { signal?: AbortSignal }) => {
          // For a game still in the live feed, pass its real start so the grader
          // can disambiguate a series/doubleheader; for an aged-out game (no feed
          // entry) fall back to the slip's creation time as the date hint.
          const createdIso = new Date(s.createdAt).toISOString();
          const input: GradeLegInput[] = s.legs.map((l) => {
            const g = legGameMatch(allGames, l.game, l.sport);
            return {
              game: l.game,
              market: l.market,
              pick: l.pick,
              sport: l.sport,
              odds: l.odds,
              startsAt: g?.startsAt ?? createdIso,
            };
          });
          return gradeBets(input, signal);
        },
      };
    }),
  });
  const slipGradeKey = slipGradeQueries.map((q) => q.dataUpdatedAt).join("|");
  const slipGradeById = useMemo(() => {
    const m = new Map<string, GradeLegResult[]>();
    savedSlips.forEach((s, i) => {
      const data = slipGradeQueries[i]?.data;
      if (data) m.set(s.id, data);
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedSlips, slipGradeKey]);

  // Tapping an AI-recommended card opens its full stats sheet: the player's REAL
  // game-log breakdown for a prop leg, or the picked team's stats sheet for a
  // game-level side. Totals (no single team) and ambiguous picks have no single
  // subject, so they stay non-tappable (gameSideFromPick returns null).
  const openAiPick = (p: ParsedPick) => {
    if (p.isProp) {
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
      return;
    }
    const side = gameSideFromPick(p);
    if (!side) return;
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

  // Tapping a slip leg opens its full stats sheet. A slip Leg keeps only text
  // (game/market/pick/odds/sport), so we reconstruct the subject here: game-level
  // legs route straight to the named team's sheet (resolved by name on that page),
  // while prop legs first resolve the player to a REAL ESPN athlete so the sheet
  // can pull their actual game log. Everything stays fail-closed — a leg we can't
  // resolve to real data simply doesn't navigate (legOpenable already gated the tap).
  const openingLegRef = useRef(false);
  const openLeg = async (leg: Leg) => {
    if (openingLegRef.current) return;
    const sport = leg.sport ?? "";
    if (!sport) return;

    if (!isGameLevelMarket(leg.market)) {
      const parsed = parsePropLeg(leg);
      if (!parsed) return;
      const isSoccer = sport === "soccer";
      let athleteId = "";
      let headshot = "";
      if (!isSoccer) {
        openingLegRef.current = true;
        try {
          const r = await searchPlayer(parsed.player);
          // Fail closed: only open a same-sport match. Falling back to another
          // sport's result would attribute this leg's stats to the wrong athlete.
          const hit = r.results.find((x) => x.sport === sport);
          if (!hit) return; // no real same-sport athlete to show
          athleteId = hit.athleteId;
          headshot = hit.headshot ?? "";
        } catch {
          return;
        } finally {
          openingLegRef.current = false;
        }
      }
      router.push({
        pathname: "/prop/[id]",
        params: {
          id: athleteId || parsed.player,
          player: parsed.player,
          marketKey: propMarketKeyForLabel(leg.market) ?? "",
          marketLabel: leg.market,
          line: parsed.line != null ? String(parsed.line) : "",
          side: parsed.side,
          odds: String(leg.odds),
          game: leg.game,
          sport,
          athleteId,
          headshot,
          startsAt: "",
          pick: leg.pick,
        },
      });
      return;
    }

    const side = gameSideFromPick({
      game: leg.game,
      market: leg.market,
      pick: leg.pick,
      odds: leg.odds,
      sport,
    });
    if (!side) return;
    router.push({
      pathname: "/team-pick/[id]",
      params: {
        id: side.name,
        team: side.name,
        opp: side.opp,
        isHome: side.isHome ? "1" : "0",
        sport,
        market: leg.market,
        line: side.line != null ? String(side.line) : "",
        odds: String(leg.odds),
        game: leg.game,
        startsAt: "",
        pick: leg.pick,
      },
    });
  };

  // Grade-then-archive finished saved slips. When ALL of a slip's games are
  // confirmed over (ESPN Final/post, or started past a generous buffer), we send
  // its legs to the server grader, archive the real W/L/push outcomes into the
  // results ledger, then remove the slip from saved (replacing the old
  // delete-only auto-clear). Honesty rules:
  //  • A leg the grader can't settle for certain comes back "ungraded" and is
  //    kept on the record but excluded from performance stats — never an
  //    invented result.
  //  • A slip with any still-ungraded leg is left in place and retried on the
  //    next feed refresh (StatMuse stat logs can lag a few hours), UNTIL its last
  //    game is FORCE_ARCHIVE_MS old, at which point we archive what we have so a
  //    permanently-ungradeable leg can't strand a slip forever.
  // A ref guards against grading the same slip concurrently across re-renders.
  const gradingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (savedSlips.length === 0) return;
    const status = legGameStatus(allGames);
    // Slips whose every leg's game is confirmed over and not already grading. A
    // game is "over" via the live feed (real Final / started past the buffer) or,
    // once the slip is old enough, via the aged-out fallback (game gone from the
    // feed but the slip is long past STALE_SLIP_MS) — so a slip is never stranded
    // just because its games dropped out of ESPN's window before grading.
    const finished = savedSlips.filter(
      (s) =>
        s.legs.length > 0 &&
        !gradingRef.current.has(s.id) &&
        s.legs.every((l) => status(l.game, l.sport, s.createdAt) === "over"),
    );
    if (finished.length === 0) return;

    let cancelled = false;
    // Every slip whose in-flight guard we claim this run, so we can release them
    // all in `finally` — otherwise a cancellation (deps changed mid-request) or a
    // run whose results are discarded would strand a slip in the guard set and it
    // would never be re-graded for the rest of the session.
    const claimed: string[] = [];
    (async () => {
      const settled: BetResult[] = [];
      try {
      for (const slip of finished) {
        gradingRef.current.add(slip.id);
        claimed.push(slip.id);
        // Resolve each leg's exact start time so the grader can disambiguate
        // series/doubleheaders; newest start drives the force-archive deadline.
        // For an aged-out game (no live-feed entry) fall back to the slip's
        // creation time so the deadline still advances and the date hint is
        // populated — otherwise newestStart stays 0, the slip never "expires",
        // and a permanently-ungradeable aged-out leg would strand it forever.
        const createdIso = new Date(slip.createdAt).toISOString();
        let newestStart = 0;
        const input: GradeLegInput[] = slip.legs.map((l) => {
          const g = legGameMatch(allGames, l.game, l.sport);
          const startsAt = g?.startsAt ?? createdIso;
          const t = Date.parse(startsAt);
          if (Number.isFinite(t)) newestStart = Math.max(newestStart, t);
          return {
            game: l.game,
            market: l.market,
            pick: l.pick,
            sport: l.sport,
            odds: l.odds,
            startsAt,
          };
        });

        let graded: Awaited<ReturnType<typeof gradeBets>> = [];
        try {
          graded = await gradeBets(input);
        } catch {
          continue; // transient — retry on next refresh (guard released in finally)
        }
        if (cancelled) return;

        const byIndex = new Map(graded.map((r) => [r.index, r]));
        const legResults: LegResult[] = slip.legs.map((l, i) => {
          const r = byIndex.get(i);
          return {
            ...l,
            result: r?.result ?? "ungraded",
            family: r?.family,
            side: r?.side,
          };
        });

        const anyUngraded = legResults.some((l) => l.result === "ungraded");
        const expired = newestStart > 0 && Date.now() - newestStart > FORCE_ARCHIVE_MS;
        // Wait (retry later) only if some leg is ungraded AND the game is still
        // recent enough that the data source may yet catch up.
        if (anyUngraded && !expired) continue; // guard released in finally

        // Parlay outcome — FAIL CLOSED on the win side. A single confirmed losing
        // leg sinks the whole parlay, so a real loss is honest even if other legs
        // never settled. But we must NOT claim a win/push while any leg is still
        // ungraded (the expired-archive case): an unconfirmed leg could have lost,
        // so the parlay outcome is "ungraded" and excluded from the W/L record.
        // The per-leg results stay honest either way (each leg keeps its own real
        // win/loss/push/ungraded), so leg-level breakdowns are unaffected.
        const slipResult: BetResult["slipResult"] = legResults.some(
          (l) => l.result === "loss",
        )
          ? "loss"
          : legResults.some((l) => l.result === "ungraded")
            ? "ungraded"
            : legResults.some((l) => l.result === "win")
              ? "win"
              : "push";

        settled.push({
          id: slip.id,
          createdAt: slip.createdAt,
          settledAt: Date.now(),
          legs: legResults,
          stake: slip.stake,
          combinedOdds: slip.combinedOdds,
          slipResult,
        });
      }
      if (!cancelled && settled.length > 0) settleSlips(settled);
      } finally {
        // Release the in-flight guard for every slip claimed this run. Committed
        // slips are removed from savedSlips by settleSlips so they won't re-grade;
        // uncommitted ones (cancelled / still-ungraded / transient error) become
        // eligible again on the next feed refresh.
        for (const id of claimed) gradingRef.current.delete(id);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gamesKey, savedSlips]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 24,
        }}
        bottomOffset={32}
      >
        <View style={{ marginBottom: 16, paddingLeft: 48 }}>
          <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 24 }}>
            Bet Slip
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 12, marginTop: 2 }}>
            {legs.length === 0 ? "No legs yet" : `${legs.length}-leg parlay`}
          </Text>
        </View>

        {/* AI-recommended picks (pinned from the AI Coach's latest parlay) */}
        {enrichedAiPicks.length > 0 ? (
          <View style={{ marginBottom: 20 }}>
            <Text
              style={{
                color: colors.primary,
                fontFamily: FONT.display,
                fontSize: 13,
                letterSpacing: 0.5,
                marginBottom: 8,
              }}
            >
              ★ AI RECOMMENDED
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 12, paddingRight: 4 }}
            >
              {enrichedAiPicks.map((p, i) => {
                const openable = p.isProp || (!!p.sport && gameSideFromPick(p) != null);
                return (
                  <View key={`${p.game}|${p.pick}|${i}`} style={{ width: 290 }}>
                    <PickCard
                      pick={p}
                      hideReadout
                      onPress={openable ? () => openAiPick(p) : undefined}
                    />
                  </View>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {legs.length === 0 ? (
          <View
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: colors.radius,
              marginBottom: 24,
            }}
          >
            <EmptyState
              icon="layers"
              title="Your slip is empty"
              subtitle="Add legs from the Home board or ask the AI Coach to build you a parlay."
            />
            <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
              <PrimaryButton label="Ask the AI Coach" icon="zap" onPress={() => router.push("/coach")} />
            </View>
          </View>
        ) : (
          <View
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: colors.radius,
              padding: 14,
              marginBottom: 24,
            }}
          >
            {legs.map((l) => (
              <LegRow
                key={l.id}
                leg={l}
                onRemove={() => removeLeg(l.id)}
                onPress={legOpenable(l) ? () => openLeg(l) : undefined}
              />
            ))}

            {/* Stake + payout */}
            <View style={{ marginTop: 14, gap: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13 }}>
                  Combined odds
                </Text>
                <Text style={{ color: colors.foreground, fontFamily: FONT.bold, fontSize: 16 }}>
                  {formatAmerican(combined)}
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13 }}>
                  Implied win prob
                </Text>
                <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
                  {(implied * 100).toFixed(1)}%
                </Text>
              </View>

              {/* "To win" sits ABOVE the Stake input on purpose: when the
                  number-pad opens it scrolls the focused Stake field just above
                  the keyboard, so anything below it would be hidden. Keeping the
                  payout above the input means the user always sees the amount
                  update as they type, no matter how many legs push the slip down. */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  backgroundColor: "rgba(34,197,94,0.12)",
                  borderRadius: 10,
                  padding: 12,
                }}
              >
                <Text style={{ color: colors.success, fontFamily: FONT.semibold, fontSize: 14 }}>
                  To win
                </Text>
                <Text style={{ color: colors.success, fontFamily: FONT.display, fontSize: 20 }}>
                  ${toWin.toFixed(2)}
                </Text>
              </View>

              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: 13 }}>
                  Stake
                </Text>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    flex: 1,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                  }}
                >
                  <Text style={{ color: colors.mutedForeground, fontFamily: FONT.bold, fontSize: 15 }}>$</Text>
                  <TextInput
                    value={String(stake)}
                    onChangeText={(t) => setStake(parseInt(t.replace(/[^0-9]/g, ""), 10) || 0)}
                    keyboardType="number-pad"
                    style={{
                      flex: 1,
                      color: colors.foreground,
                      fontFamily: FONT.bold,
                      fontSize: 15,
                      paddingVertical: 10,
                      paddingHorizontal: 6,
                    }}
                  />
                </View>
              </View>

              <Pressable
                onPress={onSaveToPhotos}
                disabled={savingImage}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  paddingVertical: 14,
                  paddingHorizontal: 18,
                  borderRadius: colors.radius,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                  opacity: savingImage ? 0.6 : pressed ? 0.85 : 1,
                })}
              >
                <Feather
                  name={savingImage ? "loader" : "download"}
                  size={16}
                  color={colors.foreground}
                />
                <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 14 }}>
                  {savingImage ? "Saving to Photos…" : "Save to Photos"}
                </Text>
              </Pressable>

              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable
                  onPress={() => {
                    clearLegs();
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    paddingVertical: 14,
                    paddingHorizontal: 18,
                    borderRadius: colors.radius,
                    borderWidth: 1,
                    borderColor: colors.border,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Feather name="trash-2" size={16} color={colors.mutedForeground} />
                  <Text style={{ color: colors.mutedForeground, fontFamily: FONT.semibold, fontSize: 14 }}>
                    Clear
                  </Text>
                </Pressable>
                <PrimaryButton
                  label="Save slip"
                  icon="bookmark"
                  style={{ flex: 1 }}
                  onPress={() => {
                    if (saveCurrentSlip()) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  }}
                />
              </View>
            </View>
          </View>
        )}

        {savedSlips.length > 0 ? (
          <>
            <SectionHeader title="Saved Slips" />
            <View style={{ gap: 12 }}>
              {savedSlips.map((s) => (
                <SavedSlipCard
                  key={s.id}
                  slip={s}
                  allGames={allGames}
                  gradeResults={slipGradeById.get(s.id)}
                  onDelete={() => deleteSlip(s.id)}
                  onOpenLeg={openLeg}
                />
              ))}
            </View>
          </>
        ) : null}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}
