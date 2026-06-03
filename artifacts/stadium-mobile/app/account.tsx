import { useAuth, useUser } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

export default function AccountScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isSignedIn, signOut } = useAuth();
  const { user } = useUser();

  // Only relevant when signed in; otherwise send them to sign-in.
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  const email =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    "Signed in";
  const initial = email.charAt(0).toUpperCase();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={{
          paddingTop: insets.top + 16,
          paddingHorizontal: 20,
          paddingBottom: 16,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={{ fontFamily: FONT.display, fontSize: 24, color: colors.foreground }}>
          Account
        </Text>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          hitSlop={12}
          accessibilityLabel="Close"
          style={{
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
      </View>

      <View style={{ paddingHorizontal: 20, gap: 16 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: colors.radius,
            padding: 16,
          }}
        >
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: colors.primary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{ fontFamily: FONT.bold, fontSize: 22, color: colors.primaryForeground }}
            >
              {initial}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{ fontFamily: FONT.semibold, fontSize: 16, color: colors.foreground }}
              numberOfLines={1}
            >
              {email}
            </Text>
            <Text
              style={{ fontFamily: FONT.body, fontSize: 13, color: colors.mutedForeground, marginTop: 2 }}
            >
              Your slips sync across devices
            </Text>
          </View>
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: colors.radius,
            padding: 16,
          }}
        >
          <Feather name="refresh-cw" size={18} color={colors.primary} />
          <Text
            style={{ flex: 1, fontFamily: FONT.body, fontSize: 14, color: colors.mutedForeground }}
          >
            Saved slips are backed up to your account and restored automatically when you
            sign in on another device.
          </Text>
        </View>

        <Pressable
          onPress={async () => {
            await signOut();
            router.replace("/");
          }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            borderWidth: 1,
            borderColor: colors.destructive,
            borderRadius: 12,
            paddingVertical: 14,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Feather name="log-out" size={18} color={colors.destructive} />
          <Text style={{ fontFamily: FONT.bold, fontSize: 15, color: colors.destructive }}>
            Sign out
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
