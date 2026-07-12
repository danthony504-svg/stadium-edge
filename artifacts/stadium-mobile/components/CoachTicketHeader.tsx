import { Feather } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { ChatMarkdown } from "@/components/ChatMarkdown";
import { FONT } from "@/components/ui";
import { usePickTracker } from "@/context/PickTrackerContext";
import { useColors } from "@/hooks/useColors";
import { partitionCoachNotes } from "@/lib/coachNotePartition";
import { buildFixedLegCountShortfallLead } from "@/lib/coachScanPolicy";
import { gradeTierColor } from "@/lib/coachLearningDisplay";
import { summarizeCoachTicket, type GameLineSummary } from "@/lib/coachTicketSummary";
import type { ParsedPick } from "@/components/PickCard";
import { similarPickRecord } from "@/lib/pickTrackerSimilar";
import { formatAmerican } from "@/lib/format";

type Props = {
  picks: ParsedPick[];
  legNote?: string;
  coachDetailNote?: string;
  /** When set and greater than pick count, shows a prominent shortfall banner. */
  requestedLegs?: number;
  /** True while the board scan is still running — shows in-progress copy, not final shortfall. */
  scanInProgress?: boolean;
};

function SummaryStat({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, minWidth: "45%" }}>
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: FONT.medium,
          fontSize: 10,
          letterSpacing: 0.4,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: valueColor ?? colors.foreground,
          fontFamily: FONT.display,
          fontSize: 18,
          marginTop: 2,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: FONT.medium,
          fontSize: 11,
          flex: 1,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: colors.foreground,
          fontFamily: FONT.semibold,
          fontSize: 12,
          textAlign: "right",
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function GameLineDetailCard({ row }: { row: GameLineSummary }) {
  const colors = useColors();
  const p = row.pick;
  const edgeStr =
    row.edge != null ? `${row.edge > 0 ? "+" : ""}${row.edge}%` : null;

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 12,
        padding: 12,
        gap: 8,
      }}
    >
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: FONT.medium,
          fontSize: 10,
          letterSpacing: 0.4,
        }}
      >
        {p.market.toUpperCase()} · {formatAmerican(p.odds)}
      </Text>
      <Text
        style={{
          color: colors.foreground,
          fontFamily: FONT.semibold,
          fontSize: 15,
        }}
      >
        {p.pick}
      </Text>
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: FONT.body,
          fontSize: 11,
        }}
      >
        {p.game}
      </Text>
      <Text
        style={{
          color: colors.foreground,
          fontFamily: FONT.body,
          fontSize: 12,
          lineHeight: 18,
        }}
      >
        {row.whyLine}
      </Text>
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: colors.border,
          paddingTop: 8,
          gap: 6,
        }}
      >
        {row.grade ? (
          <DetailRow
            label="AI Grade"
            value={row.grade}
          />
        ) : null}
        {row.confidence != null ? (
          <DetailRow label="Confidence" value={`${row.confidence}%`} />
        ) : null}
        {edgeStr ? <DetailRow label="Edge" value={edgeStr} /> : null}
        {row.simHitPct != null ? (
          <DetailRow label="Simulation hit %" value={`${row.simHitPct}%`} />
        ) : null}
        {row.fairOdds != null ? (
          <DetailRow
            label="Fair vs book odds"
            value={`${formatAmerican(row.fairOdds)} vs ${formatAmerican(row.bookOdds)}`}
          />
        ) : null}
      </View>
    </View>
  );
}

export function CoachTicketHeader({
  picks,
  legNote,
  coachDetailNote,
  requestedLegs,
  scanInProgress,
}: Props) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const { picks: trackedPicks } = usePickTracker();
  const notes = useMemo(
    () => partitionCoachNotes(legNote, coachDetailNote),
    [legNote, coachDetailNote],
  );
  const summary = useMemo(() => summarizeCoachTicket(picks), [picks]);
  const shortfallLead = useMemo(() => {
    if (requestedLegs != null && requestedLegs > summary.pickCount) {
      if (scanInProgress) {
        return `You asked for **${requestedLegs}** legs — showing **${summary.pickCount}** while the full-board scan continues.`;
      }
      return buildFixedLegCountShortfallLead(requestedLegs, summary.pickCount);
    }
    return notes.shortfall?.trim() ?? "";
  }, [requestedLegs, scanInProgress, summary.pickCount, notes.shortfall]);
  const similar = useMemo(
    () => similarPickRecord(picks, trackedPicks),
    [picks, trackedPicks],
  );
  const hasDetail = summary.gameLines.length > 0;
  const gradeColor = gradeTierColor(summary.overallGrade, colors);

  return (
    <View style={{ gap: 10 }}>
      <View
        style={{
          backgroundColor: colors.card,
          borderColor: colors.primary,
          borderWidth: 1,
          borderRadius: 14,
          padding: 14,
          gap: 12,
        }}
      >
        <Text
          style={{
            color: colors.primary,
            fontFamily: FONT.display,
            fontSize: 13,
            letterSpacing: 0.4,
          }}
        >
          AI SUMMARY
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
          <SummaryStat label="Picks" value={`${summary.pickCount}`} />
          {summary.gameLineCount > 0 ? (
            <SummaryStat label="AI game lines" value={`${summary.gameLineCount}`} />
          ) : null}
          {summary.simulations != null ? (
            <SummaryStat
              label="Simulations"
              value={summary.simulations.toLocaleString()}
            />
          ) : null}
          {summary.avgConfidence != null ? (
            <SummaryStat label="Avg confidence" value={`${summary.avgConfidence}%`} />
          ) : null}
          {summary.avgEdge != null ? (
            <SummaryStat
              label="Avg edge"
              value={`${summary.avgEdge > 0 ? "+" : ""}${summary.avgEdge}%`}
            />
          ) : null}
          {summary.overallGrade ? (
            <SummaryStat
              label="Overall AI grade"
              value={summary.overallGrade}
              valueColor={gradeColor}
            />
          ) : null}
          {similar && similar.total >= 3 ? (
            <SummaryStat
              label="Similar picks"
              value={`${similar.wins}-${similar.losses}`}
            />
          ) : null}
        </View>
        {hasDetail ? (
          <Pressable
            onPress={() => setExpanded((e) => !e)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              alignSelf: "flex-start",
              paddingVertical: 6,
              paddingHorizontal: 10,
              borderRadius: 999,
              backgroundColor: colors.background,
              borderWidth: 1,
              borderColor: colors.border,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Feather
              name={expanded ? "chevron-up" : "chevron-down"}
              size={14}
              color={colors.primary}
            />
            <Text
              style={{
                color: colors.primary,
                fontFamily: FONT.semibold,
                fontSize: 12,
              }}
            >
              Why these game lines?
            </Text>
          </Pressable>
        ) : null}
      </View>

      {shortfallLead ? (
        <View
          style={{
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: 12,
            padding: 12,
          }}
        >
          <ChatMarkdown
            text={shortfallLead}
            color={colors.foreground}
            mutedColor={colors.mutedForeground}
          />
        </View>
      ) : null}

      {expanded && summary.gameLines.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: FONT.semibold,
              fontSize: 12,
            }}
          >
            AI game lines
          </Text>
          {summary.gameLines.map((row, i) => (
            <GameLineDetailCard key={`${row.pick.game}-${row.pick.pick}-${i}`} row={row} />
          ))}
        </View>
      ) : null}

      {!shortfallLead && notes.shortfall?.trim() ? (
        <ChatMarkdown
          text={notes.shortfall.trim()}
          color={colors.foreground}
          mutedColor={colors.mutedForeground}
        />
      ) : null}
    </View>
  );
}
