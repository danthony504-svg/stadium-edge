import { useSignIn } from "@clerk/expo";
import { type Href, Link, useRouter } from "expo-router";
import React from "react";
import { Text, View } from "react-native";

import {
  AuthDivider,
  AuthField,
  AuthShell,
  GoogleAuthButton,
  PrimaryButton,
} from "@/components/auth";
import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

export default function SignInScreen() {
  const colors = useColors();
  const router = useRouter();
  const { signIn, errors, fetchStatus } = useSignIn();

  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");

  const goHome = ({
    session,
    decorateUrl,
  }: {
    session?: { currentTask?: unknown } | null;
    decorateUrl: (url: string) => string;
  }) => {
    if (session?.currentTask) return;
    router.replace(decorateUrl("/") as Href);
  };

  const handleSubmit = async () => {
    const { error } = await signIn.password({ emailAddress, password });
    if (error) return;

    if (signIn.status === "complete") {
      await signIn.finalize({ navigate: goHome });
    } else if (signIn.status === "needs_second_factor") {
      const emailCodeFactor = signIn.supportedSecondFactors?.find(
        (f) => f.strategy === "email_code",
      );
      if (emailCodeFactor) await signIn.mfa.sendEmailCode();
    }
  };

  const handleVerify = async () => {
    await signIn.mfa.verifyEmailCode({ code });
    if (signIn.status === "complete") {
      await signIn.finalize({ navigate: goHome });
    }
  };

  if (signIn.status === "needs_second_factor" || signIn.status === "needs_client_trust") {
    return (
      <AuthShell title="Verify it's you" subtitle="Enter the code we emailed you">
        <AuthField
          label="Verification code"
          value={code}
          onChangeText={setCode}
          placeholder="123456"
          keyboardType="number-pad"
          error={errors.fields.code?.message}
        />
        <PrimaryButton
          label="Verify"
          onPress={handleVerify}
          loading={fetchStatus === "fetching"}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to sync your slips across devices">
      <AuthField
        label="Email"
        value={emailAddress}
        onChangeText={setEmailAddress}
        placeholder="you@email.com"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        error={errors.fields.identifier?.message}
      />
      <AuthField
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="Your password"
        secureTextEntry
        error={errors.fields.password?.message}
      />
      <PrimaryButton
        label="Sign in"
        onPress={handleSubmit}
        disabled={!emailAddress || !password}
        loading={fetchStatus === "fetching"}
      />

      <AuthDivider />
      <GoogleAuthButton />

      <View
        style={{
          flexDirection: "row",
          justifyContent: "center",
          marginTop: 22,
        }}
      >
        <Text style={{ fontFamily: FONT.body, fontSize: 14, color: colors.mutedForeground }}>
          New here?{" "}
        </Text>
        <Link href="/sign-up" replace>
          <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.primary }}>
            Create an account
          </Text>
        </Link>
      </View>
    </AuthShell>
  );
}
