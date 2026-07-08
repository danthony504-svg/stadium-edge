import { Feather } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { ChatMarkdown } from "@/components/ChatMarkdown";
import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { partitionCoachNotes } from "@/lib/coachNotePartition";
import { summarizeCoachTicket, type GameLineSummary } from "@/lib/coachTicketSummary";
import type { ParsedPick } from "@/components/PickCard";
import { formatAmerican } from "@/lib/format";

type Props = {
  picks: ParsedPick[];
  legNote?: string;
  coachDetailNote?: string;
};

function SummaryStat({
  label,
  value,
}: {
  label: string;
  value: string;
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
          color: colors.foreground,
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

function GameLineCard({ row }: { row: GameLineSummary }) {
  const colors = useColors();
  const p = row.pick;
  const edgeStr =
    row.edge != null ? `${row.edge > 0 ? "+" : ""}${row.edge}%` : "—";
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 12,
        padding: 12,
        gap: 6,
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
          fontSize: 14,
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
      <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
        <MiniMetric label="AI Grade" value={row.grade ?? "—"} highlight />
        <MiniMetric
          label="Confidence"
          value={row.confidence != null ? `${row.confidence}%` : "—"}
        />
        <MiniMetric label="Edge" value={edgeStr} />
      </View>
    </View>
  );
}

function MiniMetric({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={{ flex: 1 }}>
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: FONT.medium,
          fontSize: 9,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: highlight ? colors.primary : colors.foreground,
          fontFamily: FONT.bold,
          fontSize: 13,
          marginTop: 2,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

export function CoachTicketHeader({ picks, legNote, coachDetailNote }: Props) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const notes = useMemo(
    () => partitionCoachNotes(legNote, coachDetailNote),
    [legNote, coachDetailNote],
  );
  const summary = useMemo(() => summarizeCoachTicket(picks), [picks]);
  const hasDetail = !!(notes.detail || summary.gameLines.length > 0);

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
          <SummaryStat
            label="AI game lines"
            value={`${summary.gameLineCount}`}
          />
          <SummaryStat
            label="Simulations"
            value={summary.simulations != null ? summary.simulations.toLocaleString() : "—"}
          />
          <SummaryStat
            label="Avg confidence"
            value={summary.avgConfidence != null ? `${summary.avgConfidence}%` : "—"}
          />
          <SummaryStat
            label="Overall AI grade"
            value={summary.overallGrade ?? "—"}
          />
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

      {expanded ? (
        <View style={{ gap: 10 }}>
          {summary.gameLines.length > 0 ? (
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
                <GameLineCard key={`${row.pick.game}-${row.pick.pick}-${i}`} row={row} />
              ))}
            </View>
          ) : null}
          {notes.detail?.trim() ? (
            <ChatMarkdown
              text={notes.detail.trim()}
              color={colors.foreground}
              mutedColor={colors.mutedForeground}
            />
          ) : null}
        </View>
      ) : null}

      {notes.shortfall?.trim() ? (
        <ChatMarkdown
          text={notes.shortfall.trim()}
          color={colors.foreground}
          mutedColor={colors.mutedForeground}
        />
      ) : null}
    </View>
  );
}
