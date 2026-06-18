import { Stack } from "expo-router";
import React from "react";
import { View } from "react-native";

import { NavMenu } from "@/components/NavMenu";
import { SlipBar } from "@/components/SlipBar";

const DARK_BG = "#0f172a";

export default function TabLayout() {
  // No auth gate: the app is freely browsable. Signing in is OPTIONAL and only
  // unlocks account-based features (cloud sync of saved slips / pick tracker,
  // push notifications, the Account screen). Those screens gate themselves and
  // route to /sign-in when a signed-out user opens them. Guests get the full
  // browsing experience — games, odds, props, the AI Coach, and a local bet
  // slip — without ever creating an account.
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
        <Stack.Screen name="coach" />
        <Stack.Screen name="props" />
        <Stack.Screen name="golf" />
        <Stack.Screen name="arbitrage" />
        <Stack.Screen name="steals" />
        <Stack.Screen name="slip" />
        <Stack.Screen name="report" />
      </Stack>
      {/* Floating slip popup + nav are siblings of the nested Stack so they
          reliably paint over tab content (a root-level overlay does not). */}
      <SlipBar />
      <NavMenu />
    </View>
  );
}
