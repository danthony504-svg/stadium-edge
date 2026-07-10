import { useAuth } from "@clerk/expo";
import { useIsFocused } from "@react-navigation/native";
import { Redirect, Stack } from "expo-router";
import React, { useEffect, useState } from "react";
import { View } from "react-native";

import { NavMenu } from "@/components/NavMenu";
import { SlipBar } from "@/components/SlipBar";

const DARK_BG = "#0f172a";

export default function TabLayout() {
  const tabsFocused = useIsFocused();
  // Hard auth gate: the main app requires sign-in. Clerk is already loaded by the
  // time this renders (ClerkLoaded wraps the root), so isSignedIn is reliable and
  // there is no signed-in flash. Unauthenticated users land on the welcome screen
  // on first open; signing in returns them here via router.replace("/").
  const { isSignedIn, isLoaded } = useAuth();
  // Brief signed-out blips during Clerk token refresh used to unmount the whole
  // tab tree (Discover flashed loaded → blank → fallback). Wait before redirecting.
  const [signOutConfirmed, setSignOutConfirmed] = useState(false);
  useEffect(() => {
    if (isSignedIn) {
      setSignOutConfirmed(false);
      return;
    }
    if (!isLoaded) return;
    const t = setTimeout(() => setSignOutConfirmed(true), 2000);
    return () => clearTimeout(t);
  }, [isSignedIn, isLoaded]);

  if (!isLoaded) {
    return <View style={{ flex: 1, backgroundColor: DARK_BG }} />;
  }
  if (!isSignedIn && signOutConfirmed) return <Redirect href="/welcome" />;
  if (!isSignedIn) {
    return <View style={{ flex: 1, backgroundColor: DARK_BG }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: DARK_BG }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: DARK_BG },
          animation: "none",
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="weather" />
        <Stack.Screen name="coach" />
        <Stack.Screen name="props" />
        <Stack.Screen name="simulator" />
        <Stack.Screen name="golf" />
        <Stack.Screen name="arbitrage" />
        <Stack.Screen name="steals" />
        <Stack.Screen name="slip" />
        <Stack.Screen name="report" />
        <Stack.Screen name="pick-performance" />
      </Stack>
      {/* Hide tab chrome while a root-stack screen (upcoming, game detail) is
          focused — avoids duplicate SlipBars and expo-router hook churn mid-push. */}
      {tabsFocused ? (
        <>
          <SlipBar />
          <NavMenu />
        </>
      ) : null}
    </View>
  );
}
