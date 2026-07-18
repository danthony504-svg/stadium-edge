import { Feather } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { FONT, TYPE, withTabular } from "@/lib/typography";

export { FONT, TYPE, TABULAR, numType, withTabular } from "@/lib/typography";
export {
  DisplayTitle,
  ScreenTitle,
  SectionHeaderText,
  CardTitle,
  PlayerName,
  BodyText,
  SecondaryText,
  CaptionText,
  ButtonText,
  StatValue,
} from "@/components/Typography";

type FeatherName = ComponentProps<typeof Feather>["name"];

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: ViewStyle;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: colors.radius,
          padding: 14,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Pill({
  label,
  active,
  icon,
  onPress,
}: {
  label: string;
  active?: boolean;
  icon?: ReactNode;
  onPress?: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 14,
          paddingVertical: 9,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: active ? colors.primary : colors.border,
          backgroundColor: active ? "rgba(59,130,246,0.12)" : colors.card,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      {icon}
      <Text
        style={{
          color: active ? colors.primary : colors.mutedForeground,
          ...TYPE.caption,
          fontFamily: active ? FONT.semibold : FONT.medium,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Badge({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: "muted" | "primary" | "accent" | "live" | "success";
}) {
  const colors = useColors();
  const map = {
    muted: { bg: colors.surface, fg: colors.mutedForeground },
    primary: { bg: "rgba(59,130,246,0.16)", fg: colors.primary },
    accent: { bg: "rgba(59,130,246,0.16)", fg: colors.accent },
    live: { bg: "rgba(244,63,94,0.16)", fg: colors.live },
    success: { bg: "rgba(34,197,94,0.16)", fg: colors.success },
  }[tone];
  return (
    <View
      style={{
        backgroundColor: map.bg,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        alignSelf: "flex-start",
      }}
    >
      <Text
        style={{
          color: map.fg,
          fontFamily: FONT.semibold,
          fontSize: 11,
          letterSpacing: 0.4,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  icon,
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress?: () => void;
  icon?: FeatherName;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          backgroundColor: colors.primary,
          paddingVertical: 14,
          borderRadius: colors.radius,
          opacity: disabled ? 0.45 : pressed ? 0.9 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.primaryForeground} size="small" />
      ) : (
        <>
          {icon ? <Feather name={icon} size={18} color={colors.primaryForeground} /> : null}
          <Text style={{ color: colors.primaryForeground, ...TYPE.button }}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 12,
      }}
    >
      <Text style={{ color: colors.foreground, ...TYPE.sectionHeader }}>{title}</Text>
      {action}
    </View>
  );
}

export function EmptyState({
  icon = "inbox",
  title,
  subtitle,
}: {
  icon?: FeatherName;
  title: string;
  subtitle?: string;
}) {
  const colors = useColors();
  return (
    <View style={{ alignItems: "center", paddingVertical: 48, gap: 10 }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name={icon} size={24} color={colors.mutedForeground} />
      </View>
      <Text style={{ color: colors.foreground, ...TYPE.cardTitle, fontSize: 17 }}>{title}</Text>
      {subtitle ? (
        <Text
          style={{
            color: colors.mutedForeground,
            ...TYPE.secondary,
            textAlign: "center",
            paddingHorizontal: 32,
          }}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const colors = useColors();
  return (
    <View style={{ alignItems: "center", paddingVertical: 48, gap: 12 }}>
      <ActivityIndicator color={colors.primary} />
      {label ? (
        <Text style={{ color: colors.mutedForeground, ...TYPE.caption }}>{label}</Text>
      ) : null}
    </View>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const colors = useColors();
  return (
    <View style={{ alignItems: "center", paddingVertical: 40, gap: 14 }}>
      <Feather name="wifi-off" size={28} color={colors.mutedForeground} />
      <Text
        style={{
          color: colors.foreground,
          ...TYPE.cardTitle,
          fontSize: 17,
          textAlign: "center",
        }}
      >
        Couldn&apos;t load live data
      </Text>
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card,
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderRadius: colors.radius,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Feather name="refresh-cw" size={15} color={colors.foreground} />
        <Text style={{ color: colors.foreground, ...TYPE.caption, fontFamily: FONT.semibold }}>
          Retry
        </Text>
      </Pressable>
    </View>
  );
}

const _styles = StyleSheet.create({});
