import { useAuth } from "@clerk/expo";
import { Stack, usePathname } from "expo-router";
import React from "react";
import { View } from "react-native";

import { NavMenu } from "@/components/NavMenu";
import { SlipBar } from "@/components/SlipBar";

const DARK_BG = "#0f172a";

/** Root-stack overlays hide the tab chrome (slip bar + hamburger). */
const TAB_CHROME_HIDDEN = /^\/(account|notifications|ota-debug|game\/|prop\/|team-pick\/|upcoming)(\/|$)/;

export default function TabLayout() {
  const pathname = usePathname();
  const tabsFocused = !TAB_CHROME_HIDDEN.test(pathname);
  const { isLoaded } = useAuth();

  // Auth is optional — signed-out users land on Home; sign in via menu when needed.
  if (!isLoaded) {
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
      {tabsFocused ? (
        <>
          <SlipBar />
          <NavMenu />
        </>
      ) : null}
    </View>
  );
}
