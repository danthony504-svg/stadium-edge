import { useSignUp } from "@clerk/expo";
import { type Href, Link, useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { Text, View } from "react-native";

import {
  APPLE_SIGN_IN_ENABLED,
  AppleAuthButton,
  AuthDivider,
  AuthField,
  AuthShell,
  PrimaryButton,
} from "@/components/auth";
import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import {
  AUTH_EMAIL_AUTOFILL,
  AUTH_NEW_PASSWORD_AUTOFILL,
  AUTH_OTP_AUTOFILL,
} from "@/lib/authFieldAutofill";
import {
  resolvePostAuthHref,
  signInHrefPreservingReturn,
} from "@/lib/pendingSubscriptionIntent";
import { loadPendingSubscriptionIntent } from "@/lib/pendingSubscriptionIntentStorage";

export default function SignUpScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{
    returnTo?: string;
    plan?: string;
    intent?: string;
  }>();
  const { signUp, errors, fetchStatus } = useSignUp();

  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");

  const signInHref = React.useMemo(() => {
    const q = new URLSearchParams();
    if (params.returnTo) q.set("returnTo", String(params.returnTo));
    if (params.plan) q.set("plan", String(params.plan));
    if (params.intent) q.set("intent", String(params.intent));
    return signInHrefPreservingReturn(q.toString());
  }, [params.returnTo, params.plan, params.intent]);

  const goHome = ({
    session,
    decorateUrl,
  }: {
    session?: { currentTask?: unknown } | null;
    decorateUrl: (url: string) => string;
  }) => {
    if (session?.currentTask) return;
    void (async () => {
      const stored = await loadPendingSubscriptionIntent();
      const target = resolvePostAuthHref({
        returnTo: typeof params.returnTo === "string" ? params.returnTo : null,
        plan: typeof params.plan === "string" ? params.plan : null,
        intent: typeof params.intent === "string" ? params.intent : null,
        stored,
      });
      router.replace(decorateUrl(target) as Href);
    })();
  };

  const handleSubmit = async () => {
    const { error } = await signUp.password({ emailAddress, password });
    if (error) return;
    await signUp.verifications.sendEmailCode();
  };

  const handleVerify = async () => {
    await signUp.verifications.verifyEmailCode({ code });
    if (signUp.status === "complete") {
      await signUp.finalize({ navigate: goHome });
    }
  };

  const needsCode =
    signUp.status === "missing_requirements" &&
    signUp.unverifiedFields.includes("email_address") &&
    signUp.missingFields.length === 0;

  if (needsCode) {
    return (
      <AuthShell title="Verify your email" subtitle="Enter the code we just sent you">
        <AuthField
          label="Verification code"
          value={code}
          onChangeText={setCode}
          placeholder="123456"
          keyboardType="number-pad"
          {...AUTH_OTP_AUTOFILL}
          error={errors.fields.code?.message}
        />
        <PrimaryButton
          label="Verify & continue"
          onPress={handleVerify}
          loading={fetchStatus === "fetching"}
        />
        <View style={{ alignItems: "center", marginTop: 16 }}>
          <Text
            onPress={() => signUp.verifications.sendEmailCode()}
            style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.primary }}
          >
            Resend code
          </Text>
        </View>
        <View nativeID="clerk-captcha" />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create your account" subtitle="Save your slips and sync them everywhere">
      <AuthField
        label="Email"
        value={emailAddress}
        onChangeText={setEmailAddress}
        placeholder="you@email.com"
        keyboardType="email-address"
        {...AUTH_EMAIL_AUTOFILL}
        error={errors.fields.emailAddress?.message}
      />
      <AuthField
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="Create a password"
        secureTextEntry
        {...AUTH_NEW_PASSWORD_AUTOFILL}
        error={errors.fields.password?.message}
      />
      <PrimaryButton
        label="Sign up"
        onPress={handleSubmit}
        disabled={!emailAddress || !password}
        loading={fetchStatus === "fetching"}
      />

      {APPLE_SIGN_IN_ENABLED ? (
        <>
          <AuthDivider />
          <AppleAuthButton
            returnTo={typeof params.returnTo === "string" ? params.returnTo : null}
            plan={typeof params.plan === "string" ? params.plan : null}
            intent={typeof params.intent === "string" ? params.intent : null}
          />
        </>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          justifyContent: "center",
          marginTop: 22,
        }}
      >
        <Text style={{ fontFamily: FONT.body, fontSize: 14, color: colors.mutedForeground }}>
          Already have an account?{" "}
        </Text>
        <Link href={signInHref as Href} replace>
          <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.primary }}>
            Sign in
          </Text>
        </Link>
      </View>

      {/* Required for sign-up — Clerk's bot protection is enabled by default. */}
      <View nativeID="clerk-captcha" />
    </AuthShell>
  );
}
