import {
  BricolageGrotesque_400Regular,
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_800ExtraBold,
} from "@expo-google-fonts/bricolage-grotesque";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { ClerkLoaded, ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import React, { useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LockScreen } from "@/components/LockScreen";
import { AppLockProvider, useAppLock } from "@/context/AppLockContext";
import { BetSlipProvider } from "@/context/BetSlipContext";
import { setAuthTokenGetter } from "@/lib/api";

// Clerk publishable key + proxy URL come from the environment (dev script /
// build.js). Empty in dev for the proxy (Clerk hits dev FAPI directly), set in
// prod. Auth is REQUIRED — the (tabs) layout gates the app behind sign-in, so on
// first open a signed-out user is sent to the login screen.
const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
const proxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;

// Registers the Clerk session-token getter with the API client so authed sync
// requests carry a Bearer token. Lives inside ClerkProvider so useAuth works.
function AuthTokenBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);
  return null;
}

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// App is dark-only — keep the root surface navy so there is never a white flash.
SystemUI.setBackgroundColorAsync("#0f172a");

const queryClient = new QueryClient();
const DARK_BG = "#0f172a";

function RootLayoutNav() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: DARK_BG },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="game/[id]" options={{ presentation: "card" }} />
      <Stack.Screen name="upcoming" options={{ presentation: "card" }} />
      <Stack.Screen name="(auth)" options={{ presentation: "card" }} />
      <Stack.Screen name="account" options={{ presentation: "card" }} />
    </Stack>
  );
}

// Renders the biometric lock overlay above the whole app while engaged.
// Fails closed: until the provider has loaded the persisted setting + checked
// hardware (`ready`), it covers the app with an opaque navy screen so protected
// content can never flash before the lock can engage on cold start.
function AppLockGate() {
  const { ready, locked, enabled, supported } = useAppLock();
  if (!ready) {
    return (
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: DARK_BG,
          zIndex: 9999,
        }}
      />
    );
  }
  if (!locked || !enabled || !supported) return null;
  return <LockScreen />;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Bricolage_400Regular: BricolageGrotesque_400Regular,
    Bricolage_600SemiBold: BricolageGrotesque_600SemiBold,
    Bricolage_800ExtraBold: BricolageGrotesque_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <ClerkProvider
          publishableKey={publishableKey}
          tokenCache={tokenCache}
          proxyUrl={proxyUrl}
        >
          <ClerkLoaded>
            <QueryClientProvider client={queryClient}>
              <AuthTokenBridge />
              <AppLockProvider>
                <BetSlipProvider>
                  <GestureHandlerRootView style={{ flex: 1, backgroundColor: DARK_BG }}>
                    <KeyboardProvider>
                      <StatusBar style="light" />
                      <RootLayoutNav />
                      <AppLockGate />
                    </KeyboardProvider>
                  </GestureHandlerRootView>
                </BetSlipProvider>
              </AppLockProvider>
            </QueryClientProvider>
          </ClerkLoaded>
        </ClerkProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
