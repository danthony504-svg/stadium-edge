import { useSignIn } from "@clerk/expo";
import { type Href, Link, useRouter } from "expo-router";
import React from "react";
import { Pressable, Text, View } from "react-native";

import {
  AuthDivider,
  AuthField,
  AuthShell,
  GoogleAuthButton,
  PrimaryButton,
} from "@/components/auth";
import { FONT } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

type Mode = "signin" | "resetRequest" | "resetVerify";

export default function SignInScreen() {
  const colors = useColors();
  const router = useRouter();
  const { signIn, errors, fetchStatus } = useSignIn();

  const [mode, setMode] = React.useState<Mode>("signin");
  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [formError, setFormError] = React.useState("");

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

  // Forgot-password step 1: identify the account, then email a reset code.
  // signIn.create() starts a fresh attempt, clearing any prior sign-in state.
  const handleSendResetCode = async () => {
    setFormError("");
    const created = await signIn.create({ identifier: emailAddress });
    if (created.error) return;
    const sent = await signIn.resetPasswordEmailCode.sendCode();
    if (sent.error) return;
    setCode("");
    setNewPassword("");
    setMode("resetVerify");
  };

  // Forgot-password step 2: verify the code and set the new password.
  const handleResetPassword = async () => {
    setFormError("");
    const verified = await signIn.resetPasswordEmailCode.verifyCode({ code });
    if (verified.error) return;
    const submitted = await signIn.resetPasswordEmailCode.submitPassword({
      password: newPassword,
    });
    if (submitted.error) return;
    if (signIn.status === "complete") {
      await signIn.finalize({ navigate: goHome });
    } else {
      setFormError("Couldn't finish resetting your password. Please try again.");
    }
  };

  // Abandon the reset flow: discard Clerk's in-progress attempt so the normal
  // password / MFA sign-in paths start from a clean state.
  const backToSignIn = async () => {
    await signIn.reset();
    setCode("");
    setNewPassword("");
    setFormError("");
    setMode("signin");
  };

  const TextLink = ({
    label,
    onPress,
    align = "center",
  }: {
    label: string;
    onPress: () => void;
    align?: "center" | "right";
  }) => (
    <Pressable
      onPress={onPress}
      style={{ alignSelf: align === "right" ? "flex-end" : "center" }}
      hitSlop={8}
    >
      <Text style={{ fontFamily: FONT.semibold, fontSize: 14, color: colors.primary }}>
        {label}
      </Text>
    </Pressable>
  );

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

  if (mode === "resetRequest") {
    return (
      <AuthShell
        title="Reset your password"
        subtitle="Enter your email and we'll send you a reset code"
      >
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
        <PrimaryButton
          label="Send reset code"
          onPress={handleSendResetCode}
          disabled={!emailAddress}
          loading={fetchStatus === "fetching"}
        />
        <View style={{ marginTop: 22 }}>
          <TextLink label="Back to sign in" onPress={backToSignIn} />
        </View>
      </AuthShell>
    );
  }

  if (mode === "resetVerify") {
    return (
      <AuthShell
        title="Check your email"
        subtitle={`Enter the code we sent to ${emailAddress} and choose a new password`}
      >
        <AuthField
          label="Reset code"
          value={code}
          onChangeText={setCode}
          placeholder="123456"
          keyboardType="number-pad"
          error={errors.fields.code?.message}
        />
        <AuthField
          label="New password"
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="Your new password"
          secureTextEntry
          error={errors.fields.password?.message}
        />
        <PrimaryButton
          label="Reset password"
          onPress={handleResetPassword}
          disabled={!code || !newPassword}
          loading={fetchStatus === "fetching"}
        />
        {formError ? (
          <Text
            style={{
              fontFamily: FONT.body,
              fontSize: 13,
              color: colors.destructive,
              textAlign: "center",
              marginTop: 12,
            }}
          >
            {formError}
          </Text>
        ) : null}
        <View style={{ marginTop: 16, gap: 14, alignItems: "center" }}>
          <TextLink label="Resend code" onPress={handleSendResetCode} />
          <TextLink label="Back to sign in" onPress={backToSignIn} />
        </View>
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
      <View style={{ marginTop: -4, marginBottom: 8 }}>
        <TextLink
          label="Forgot password?"
          align="right"
          onPress={() => setMode("resetRequest")}
        />
      </View>
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
