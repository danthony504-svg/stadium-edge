import { useAuth } from "@clerk/expo";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { savePendingInvite } from "@/lib/referralApi";
import { useColors } from "@/hooks/useColors";
export default function InviteScreen() {
  const colors = useColors();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { isSignedIn, isLoaded } = useAuth();
  const router = useRouter();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!isLoaded) return;
    let active = true;
    void savePendingInvite(code)
      .then((ok) => {
        if (!active) return;
        if (!ok) {
          setError(
            "This invite code is invalid. Ask your friend for a fresh link.",
          );
          return;
        }
        router.replace(
          isSignedIn
            ? "/account"
            : { pathname: "/sign-up", params: { returnTo: "account" } },
        );
      })
      .catch(() => {
        if (active)
          setError(
            "We couldn't save this invite. You can enter the code under Account → Refer a friend after signing up.",
          );
      });
    return () => {
      active = false;
    };
  }, [code, isSignedIn, isLoaded, router]);
  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        padding: 24,
        gap: 20,
        backgroundColor: colors.background,
      }}
    >
      {error ? (
        <>
          <Text style={{ color: colors.foreground }}>{error}</Text>
          <Pressable onPress={() => router.replace("/")}>
            <Text style={{ color: colors.primary }}>
              Continue to Stadium Edge
            </Text>
          </Pressable>
        </>
      ) : (
        <ActivityIndicator color={colors.primary} />
      )}
    </View>
  );
}
