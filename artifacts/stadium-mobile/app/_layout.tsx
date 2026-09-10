// Per-weight subpaths only: the package barrels `require()` every weight, so
// importing from them ships every unused TTF in the OTA payload.
import { BricolageGrotesque_400Regular } from "@expo-google-fonts/bricolage-grotesque/400Regular";
import { BricolageGrotesque_600SemiBold } from "@expo-google-fonts/bricolage-grotesque/600SemiBold";
import { BricolageGrotesque_800ExtraBold } from "@expo-google-fonts/bricolage-grotesque/800ExtraBold";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { useFonts } from "@expo-google-fonts/inter/useFonts";
import { ClerkLoaded, ClerkLoading, ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { DeferredOtaRuntime } from "@/components/DeferredOtaRuntime";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { BetSlipProvider } from "@/context/BetSlipContext";
import { PickTrackerProvider } from "@/context/PickTrackerContext";
import { setAuthTokenGetter } from "@/lib/authToken";
import {
  addNotificationResponseListener,
  registerForPushAsync,
} from "@/lib/notifications";

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
const proxyUrl = publishableKey.startsWith("pk_live")
  ? process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined
  : undefined;

function AuthTokenBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);
  return null;
}

function PushNotificationsBridge() {
  const { isSignedIn } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isSignedIn) return;
    registerForPushAsync().catch(() => {});
  }, [isSignedIn]);

  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    void addNotificationResponseListener((path) => router.navigate(path as never)).then(
      (listener) => {
        sub = listener;
      },
    );
    return () => sub?.remove();
  }, [router]);

  return null;
}

/**
 * Module scope runs before any error boundary exists, so a native module that
 * throws or rejects here aborts the launch outright. Never let these escape.
 */
function ignoreStartupFailure(run: () => Promise<unknown>): void {
  try {
    void run().catch(() => {});
  } catch {
    // Native module unavailable — startup must continue regardless.
  }
}

ignoreStartupFailure(() => SplashScreen.preventAutoHideAsync());
ignoreStartupFailure(() => SystemUI.setBackgroundColorAsync("#0f172a"));

const queryClient = new QueryClient({ defaultOptions: { queries: {} } });
const DARK_BG = "#0f172a";

function BootScreen() {
  const [showRetry, setShowRetry] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShowRetry(true), 15000);
    return () => clearTimeout(t);
  }, []);
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: DARK_BG,
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
      }}
    >
      <ActivityIndicator size="large" color="#38bdf8" />
      {showRetry ? (
        <Text
          style={{
            color: "#e2e8f0",
            fontSize: 15,
            lineHeight: 21,
            textAlign: "center",
            marginTop: 22,
          }}
        >
          Having trouble connecting. Check your internet connection and try again.
        </Text>
      ) : null}
    </View>
  );
}

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
      <Stack.Screen name="prop/[id]" options={{ presentation: "card" }} />
      <Stack.Screen name="team-pick/[id]" options={{ presentation: "card" }} />
      <Stack.Screen name="upcoming" options={{ presentation: "card" }} />
      <Stack.Screen name="(auth)" options={{ presentation: "card" }} />
      <Stack.Screen name="account" options={{ presentation: "card" }} />
      <Stack.Screen name="notifications" options={{ presentation: "card" }} />
      <Stack.Screen name="ota-debug" options={{ presentation: "card" }} />
    </Stack>
  );
}

/**
 * Silent check/fetch on launch + foreground. Auto-reloads when safe;
 * OtaUpdateBanner always provides a production Restart path if pending.
 * Detailed OTA Diagnostics remain available on the /ota-debug screen.
 * DeferredOtaRuntime keeps all of that off the startup path until first paint.
 */
function AppShell() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthTokenBridge />
      <PushNotificationsBridge />
      <BetSlipProvider>
        <PickTrackerProvider>
          <GestureHandlerRootView style={{ flex: 1, backgroundColor: DARK_BG }}>
            <KeyboardProvider>
              <StatusBar style="light" />
              <RootLayoutNav />
              <DeferredOtaRuntime />
            </KeyboardProvider>
          </GestureHandlerRootView>
        </PickTrackerProvider>
      </BetSlipProvider>
    </QueryClientProvider>
  );
}

function RootLayoutContent() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    BricolageGrotesque_400Regular: BricolageGrotesque_400Regular,
    BricolageGrotesque_600SemiBold: BricolageGrotesque_600SemiBold,
    BricolageGrotesque_800ExtraBold: BricolageGrotesque_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      ignoreStartupFailure(() => SplashScreen.hideAsync());
    }
  }, [fontsLoaded, fontError]);

  if (!publishableKey) {
    return (
      <View style={{ flex: 1, backgroundColor: DARK_BG, padding: 32, justifyContent: "center" }}>
        <Text style={{ color: "#e2e8f0", fontSize: 15, textAlign: "center", lineHeight: 22 }}>
          App configuration error (missing auth key). Reinstall from the App Store or contact support.
        </Text>
      </View>
    );
  }

  if (!fontsLoaded && !fontError) {
    return (
      <View style={{ flex: 1, backgroundColor: DARK_BG }}>
        <BootScreen />
      </View>
    );
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache} proxyUrl={proxyUrl}>
      <ClerkLoading>
        <BootScreen />
      </ClerkLoading>
      <ClerkLoaded>
        <AppShell />
      </ClerkLoaded>
    </ClerkProvider>
  );
}

/**
 * ErrorBoundary wraps the whole app render, including useFonts, the missing-key
 * screen and the pre-Clerk boot path — a throw in any of those used to escape
 * to the native handler and fail the launch. SafeAreaProvider stays above it
 * because the fallback screen reads safe-area insets.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <RootLayoutContent />
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
