import { useSignUp } from "@clerk/expo";
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

export default function SignUpScreen() {
  const colors = useColors();
  const router = useRouter();
  const { signUp, errors, fetchStatus } = useSignUp();

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
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        error={errors.fields.emailAddress?.message}
      />
      <AuthField
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="Create a password"
        secureTextEntry
        error={errors.fields.password?.message}
      />
      <PrimaryButton
        label="Sign up"
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
          Already have an account?{" "}
        </Text>
        <Link href="/sign-in" replace>
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
