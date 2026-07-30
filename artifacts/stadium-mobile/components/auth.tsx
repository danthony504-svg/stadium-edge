import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { type Href, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

// Blue accent used across the auth screens to match the "Welcome back" mockup.
export const AUTH_ACCENT = "#3b82f6";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

// Branded card wrapper: navy background, close button, Stadium Edge logo,
// title + subtitle. Used by both sign-in and sign-up so they feel native.
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: 24,
          justifyContent: "center",
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          hitSlop={12}
          accessibilityLabel="Close"
          style={{
            position: "absolute",
            top: insets.top + 12,
            right: 20,
            width: 38,
            height: 38,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Feather name="x" size={20} color={colors.foreground} />
        </Pressable>

        <View style={{ alignItems: "center", marginBottom: 28 }}>
          <Image
            source={require("@/assets/images/logo.png")}
            style={{ width: 232, height: 100, marginBottom: 14 }}
            contentFit="contain"
          />
          <Text
            style={{
              fontFamily: FONT.display,
              fontSize: 30,
              color: colors.foreground,
              textAlign: "center",
            }}
          >
            {title}
          </Text>
          <Text
            style={{
              fontFamily: FONT.body,
              fontSize: 15,
              color: colors.mutedForeground,
              textAlign: "center",
              marginTop: 8,
              lineHeight: 21,
            }}
          >
            {subtitle}
          </Text>
        </View>

        {children}
      </ScrollView>
    </View>
  );
}

// Labeled input with an optional left icon. When `secureTextEntry` is set it
// renders an eye toggle to show/hide the password.
export function AuthField({
  label,
  error,
  leftIcon,
  secureTextEntry,
  ...props
}: React.ComponentProps<typeof TextInput> & {
  label: string;
  error?: string;
  leftIcon?: FeatherName;
}) {
  const colors = useColors();
  const [hidden, setHidden] = useState(true);
  const isSecure = !!secureTextEntry;

  return (
    <View style={{ marginBottom: 14 }}>
      <Text
        style={{
          fontFamily: FONT.medium,
          fontSize: 13,
          color: colors.mutedForeground,
          marginBottom: 6,
        }}
      >
        {label}
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: error ? colors.destructive : colors.border,
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: Platform.OS === "ios" ? 13 : 9,
        }}
      >
        {leftIcon ? (
          <Feather
            name={leftIcon}
            size={18}
            color={AUTH_ACCENT}
            style={{ marginRight: 10 }}
          />
        ) : null}
        <TextInput
          placeholderTextColor={colors.mutedForeground}
          secureTextEntry={isSecure ? hidden : false}
          style={{
            flex: 1,
            padding: 0,
            color: colors.foreground,
            fontFamily: FONT.body,
            fontSize: 16,
          }}
          {...props}
        />
        {isSecure ? (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            hitSlop={8}
            accessibilityLabel={hidden ? "Show password" : "Hide password"}
          >
            <Feather name={hidden ? "eye" : "eye-off"} size={18} color={AUTH_ACCENT} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text
          style={{
            fontFamily: FONT.body,
            fontSize: 12,
            color: colors.destructive,
            marginTop: 5,
          }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => ({
        borderRadius: 12,
        overflow: "hidden",
        marginTop: 6,
        opacity: disabled ? 0.45 : pressed ? 0.9 : 1,
      })}
    >
      <LinearGradient
        colors={[AUTH_ACCENT, AUTH_ACCENT]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          paddingVertical: 15,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {loading ? (
          <ActivityIndicator color="#0a1020" />
        ) : (
          <Text style={{ fontFamily: FONT.bold, fontSize: 16, color: "#0a1020" }}>
            {label}
          </Text>
        )}
      </LinearGradient>
    </Pressable>
  );
}

