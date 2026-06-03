import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Link, useRouter } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AUTH_ACCENT, GoogleAuthButton } from "@/components/auth";
import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

type FeatherName = React.ComponentProps<typeof Feather>["name"];
type MCName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

const FEATURES: {
  family: "feather" | "mc";
  icon: FeatherName | MCName;
  title: string;
  desc: string;
}[] = [
  {
    family: "mc",
    icon: "brain",
    title: "AI Prop Analysis",
    desc: "Advanced AI finds value in player props and lines.",
  },
  {
    family: "feather",
    icon: "trending-up",
    title: "Real-Time Data",
    desc: "Live line movement and odds updates 24/7.",
  },
  {
    family: "feather",
    icon: "layers",
    title: "Smart Parlay Builder",
    desc: "Build better parlays with AI-powered recommendations.",
  },
  {
    family: "feather",
    icon: "target",
    title: "High Confidence Picks",
    desc: "Only the highest confidence plays make the cut.",
  },
];

const TRUST: { icon: FeatherName; title: string; desc: string }[] = [
  { icon: "shield", title: "Free to join", desc: "No credit card required" },
  { icon: "lock", title: "Secure & private", desc: "Your data is always protected" },
  { icon: "users", title: "Join 50,000+", desc: "bettors gaining the edge" },
];

function FeatureCard({ item }: { item: (typeof FEATURES)[number] }) {
  const colors = useColors();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 14,
        paddingVertical: 14,
        paddingHorizontal: 8,
        alignItems: "center",
      }}
    >
      {item.family === "mc" ? (
        <MaterialCommunityIcons name={item.icon as MCName} size={22} color={AUTH_ACCENT} />
      ) : (
        <Feather name={item.icon as FeatherName} size={22} color={AUTH_ACCENT} />
      )}
      <Text
        style={{
          fontFamily: FONT.bold,
          fontSize: 11,
          color: colors.foreground,
          textAlign: "center",
          marginTop: 8,
        }}
      >
        {item.title}
      </Text>
      <Text
        style={{
          fontFamily: FONT.body,
          fontSize: 9.5,
          color: colors.mutedForeground,
          textAlign: "center",
          marginTop: 4,
          lineHeight: 13,
        }}
      >
        {item.desc}
      </Text>
    </View>
  );
}

export default function WelcomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={{ height: 430 }}>
          <Image
            source={require("@/assets/images/welcome-hero.png")}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
          <LinearGradient
            colors={["rgba(15,23,42,0.25)", "rgba(15,23,42,0.6)", "#0f172a"]}
            locations={[0, 0.6, 1]}
            style={StyleSheet.absoluteFill}
          />

          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/sign-in"))}
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
              backgroundColor: "rgba(2,6,23,0.6)",
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Feather name="x" size={20} color={colors.foreground} />
          </Pressable>

          <View
            style={{
              flex: 1,
              paddingHorizontal: 24,
              paddingTop: insets.top + 14,
              justifyContent: "flex-end",
              paddingBottom: 6,
            }}
          >
            <Image
              source={require("@/assets/images/logo.png")}
              style={{ width: 168, height: 72, marginBottom: "auto" }}
              contentFit="contain"
            />
            <Text
              style={{ fontFamily: FONT.display, fontSize: 40, color: colors.foreground }}
            >
              Bet Smarter.
            </Text>
            <Text style={{ fontFamily: FONT.display, fontSize: 40, color: AUTH_ACCENT }}>
              Win More.
            </Text>
            <Text
              style={{
                fontFamily: FONT.body,
                fontSize: 15,
                color: colors.mutedForeground,
                marginTop: 10,
                lineHeight: 21,
                maxWidth: 320,
              }}
            >
              AI-powered insights, real-time data, and winning picks—all in one edge.
            </Text>
          </View>
        </View>

        <View style={{ paddingHorizontal: 24, paddingTop: 20 }}>
          {/* Feature cards */}
          <View style={{ flexDirection: "row", gap: 8 }}>
            {FEATURES.map((f) => (
              <FeatureCard key={f.title} item={f} />
            ))}
          </View>

          {/* Create Free Account */}
          <Pressable
            onPress={() => router.push("/sign-up")}
            style={({ pressed }) => ({
              borderRadius: 14,
              overflow: "hidden",
              marginTop: 24,
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <LinearGradient
              colors={[AUTH_ACCENT, AUTH_ACCENT]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ paddingVertical: 16, alignItems: "center" }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Feather name="gift" size={20} color="#0a1020" />
                <Text style={{ fontFamily: FONT.bold, fontSize: 17, color: "#0a1020" }}>
                  Create Free Account
                </Text>
              </View>
              <Text
                style={{
                  fontFamily: FONT.medium,
                  fontSize: 13,
                  color: "rgba(10,16,32,0.75)",
                  marginTop: 3,
                }}
              >
                Free to join. Cancel anytime.
              </Text>
            </LinearGradient>
          </Pressable>

          {/* Google */}
          <View style={{ marginTop: 14 }}>
            <GoogleAuthButton />
          </View>

          {/* Trust badges */}
          <View
            style={{
              flexDirection: "row",
              marginTop: 24,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              paddingTop: 18,
            }}
          >
            {TRUST.map((t, i) => (
              <View
                key={t.title}
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: 8,
                  paddingHorizontal: 4,
                  borderLeftWidth: i === 0 ? 0 : 1,
                  borderLeftColor: colors.border,
                }}
              >
                <Feather name={t.icon} size={18} color={AUTH_ACCENT} style={{ marginTop: 1 }} />
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ fontFamily: FONT.bold, fontSize: 11, color: colors.foreground }}
                  >
                    {t.title}
                  </Text>
                  <Text
                    style={{
                      fontFamily: FONT.body,
                      fontSize: 10,
                      color: colors.mutedForeground,
                      marginTop: 2,
                      lineHeight: 13,
                    }}
                  >
                    {t.desc}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {/* Sign in */}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "center",
              marginTop: 26,
            }}
          >
            <Text
              style={{ fontFamily: FONT.body, fontSize: 14, color: colors.mutedForeground }}
            >
              Already have an account?{" "}
            </Text>
            <Link href="/sign-in" replace>
              <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: AUTH_ACCENT }}>
                Sign in
              </Text>
            </Link>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
