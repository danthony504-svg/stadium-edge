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

export const FONT = {
  display: "Bricolage_800ExtraBold",
  displaySemi: "Bricolage_600SemiBold",
  body: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

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
          backgroundColor: active ? "rgba(34,211,238,0.12)" : colors.card,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      {icon}
      <Text
        style={{
          color: active ? colors.primary : colors.mutedForeground,
          fontFamily: active ? FONT.bold : FONT.medium,
          fontSize: 13,
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
    primary: { bg: "rgba(34,211,238,0.16)", fg: colors.primary },
    accent: { bg: "rgba(6,182,212,0.16)", fg: colors.accent },
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
          fontSize: 11,
          fontFamily: FONT.bold,
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
          <Text style={{ color: colors.primaryForeground, fontFamily: FONT.bold, fontSize: 15 }}>
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
      <Text style={{ color: colors.foreground, fontFamily: FONT.display, fontSize: 18 }}>
        {title}
      </Text>
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
      <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 15 }}>
        {title}
      </Text>
      {subtitle ? (
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: FONT.body,
            fontSize: 13,
            textAlign: "center",
            paddingHorizontal: 32,
            lineHeight: 19,
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
        <Text style={{ color: colors.mutedForeground, fontFamily: FONT.body, fontSize: 13 }}>
          {label}
        </Text>
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
          fontFamily: FONT.semibold,
          fontSize: 15,
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
        <Text style={{ color: colors.foreground, fontFamily: FONT.semibold, fontSize: 13 }}>
          Retry
        </Text>
      </Pressable>
    </View>
  );
}

const _styles = StyleSheet.create({});
