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
import { ClerkLoaded, ClerkLoading, ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import * as Updates from "expo-updates";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { BetSlipProvider } from "@/context/BetSlipContext";
import { setAuthTokenGetter } from "@/lib/api";
import {
  addNotificationResponseListener,
  registerForPushAsync,
} from "@/lib/notifications";

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

// Registers this device for push once Clerk reports a signed-in session (the
// register call is authed), and wires a tap listener that deep-links to the
// relevant screen. No-op while signed out; the tap listener is always active.
function PushNotificationsBridge() {
  const { isSignedIn } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isSignedIn) return;
    registerForPushAsync().catch(() => {});
  }, [isSignedIn]);

  useEffect(() => {
    const sub = addNotificationResponseListener((path) => router.navigate(path as never));
    return () => sub.remove();
  }, [router]);

  return null;
}

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// App is dark-only — keep the root surface navy so there is never a white flash.
SystemUI.setBackgroundColorAsync("#0f172a");

const queryClient = new QueryClient();
const DARK_BG = "#0f172a";

// Shown while Clerk is still initializing. If init never completes (e.g. the
// auth backend is unreachable), surface a retry after a timeout instead of
// leaving the user on a silent blank navy screen forever.
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
        <>
          <Text
            style={{
              color: "#e2e8f0",
              fontSize: 15,
              lineHeight: 21,
              textAlign: "center",
              marginTop: 22,
            }}
          >
            Having trouble connecting. Check your internet connection and try
            again.
          </Text>
          <Pressable
            onPress={() => {
              Updates.reloadAsync().catch(() => {});
            }}
            style={{
              marginTop: 18,
              paddingVertical: 11,
              paddingHorizontal: 28,
              backgroundColor: "#1e293b",
              borderRadius: 12,
            }}
          >
            <Text style={{ color: "#38bdf8", fontSize: 15, fontWeight: "600" }}>
              Retry
            </Text>
          </Pressable>
        </>
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
    </Stack>
  );
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

  // Pull JS-only fixes without a new App Store build. Defer until after the
  // first screen paints so a bad OTA can't brick cold start (reload mid-boot
  // was leaving a blank navy screen on TestFlight).
  useEffect(() => {
    if (__DEV__) return;
    const timer = setTimeout(() => {
      (async () => {
        try {
          const update = await Updates.checkForUpdateAsync();
          if (!update.isAvailable) return;
          await Updates.fetchUpdateAsync();
          // Rollback-to-embedded or a new bundle — reload only after fetch succeeds.
          await Updates.reloadAsync();
        } catch {
          // Offline or expo-updates disabled — keep running the embedded bundle.
        }
      })();
    }, 8000);
    return () => clearTimeout(timer);
  }, []);

  if (!fontsLoaded && !fontError) {
    return (
      <View style={{ flex: 1, backgroundColor: DARK_BG }}>
        <BootScreen />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <ClerkProvider
          publishableKey={publishableKey}
          tokenCache={tokenCache}
          proxyUrl={proxyUrl}
        >
          <ClerkLoading>
            <BootScreen />
          </ClerkLoading>
          <ClerkLoaded>
            <QueryClientProvider client={queryClient}>
              <AuthTokenBridge />
              <PushNotificationsBridge />
              <BetSlipProvider>
                <GestureHandlerRootView style={{ flex: 1, backgroundColor: DARK_BG }}>
                  <KeyboardProvider>
                    <StatusBar style="light" />
                    <RootLayoutNav />
                  </KeyboardProvider>
                </GestureHandlerRootView>
              </BetSlipProvider>
            </QueryClientProvider>
          </ClerkLoaded>
        </ClerkProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
