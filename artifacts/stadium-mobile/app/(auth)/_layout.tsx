import { useAuth } from "@clerk/expo";
import { Redirect, Stack, type Href } from "expo-router";
import React from "react";

import { plansHrefForSubscriptionIntent } from "@/lib/pendingSubscriptionIntent";
import { loadPendingSubscriptionIntent } from "@/lib/pendingSubscriptionIntentStorage";

const DARK_BG = "#0f172a";

/**
 * Auth is optional. Already-signed-in users leave this stack — prefer returning
 * to Plans when a pending subscription intent exists (selection only; no auto-buy).
 */
function SignedInRedirect() {
  const [href, setHref] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const intent = await loadPendingSubscriptionIntent();
      if (cancelled) return;
      setHref(intent ? plansHrefForSubscriptionIntent(intent) : "/");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!href) return null;
  return <Redirect href={href as Href} />;
}

export default function AuthLayout() {
  const { isSignedIn } = useAuth();
  if (isSignedIn) return <SignedInRedirect />;
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: DARK_BG },
      }}
    />
  );
}
