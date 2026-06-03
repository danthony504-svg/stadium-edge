import { Stack } from "expo-router";
import React from "react";
import { View } from "react-native";

import { NavMenu } from "@/components/NavMenu";

const DARK_BG = "#0f172a";

export default function TabLayout() {
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
        <Stack.Screen name="slip" />
      </Stack>
      <NavMenu />
    </View>
  );
}
