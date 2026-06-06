import { useAuth } from "@clerk/expo";
import { Redirect, Stack } from "expo-router";
import React from "react";

const DARK_BG = "#0f172a";

// Auth is optional in this app. These screens are only for users who choose to
// sign in; an already-signed-in user is bounced to the home tab.
export default function AuthLayout() {
  const { isSignedIn } = useAuth();
  if (isSignedIn) return <Redirect href="/" />;
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: DARK_BG },
      }}
    />
  );
}
