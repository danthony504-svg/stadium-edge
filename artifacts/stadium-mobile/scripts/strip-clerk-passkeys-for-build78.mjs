#!/usr/bin/env node
/**
 * EAS hook helper for profile `preview-build78`.
 *
 * When EXPO_NO_CLERK_PASSKEYS=1:
 *  - Do NOT remove @clerk/expo-passkeys from package.json (that breaks
 *    `pnpm install --frozen-lockfile` on EAS).
 *  - Pin expo.autolinking.exclude so the native module is not linked.
 *  - After install (post-install phase), delete the installed package so
 *    CocoaPods/autolinking cannot rediscover it — matching Build 78
 *    (ClerkExpoPasskeys absent from that native binary).
 *
 * Other native deps stay as-is. react-native.config.js also nulls platforms
 * when the same env flag is set.
 *
 * Usage:
 *   eas-build-pre-install  → node scripts/strip-clerk-passkeys-for-build78.mjs
 *   eas-build-post-install → node scripts/strip-clerk-passkeys-for-build78.mjs --post-install
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const enabled = String(process.env.EXPO_NO_CLERK_PASSKEYS ?? "") === "1";
const postInstall = process.argv.includes("--post-install");

if (!enabled) {
  console.log("[strip-clerk-passkeys] EXPO_NO_CLERK_PASSKEYS!=1 — no-op");
  process.exit(0);
}

if (!postInstall) {
  const pkgPath = join(root, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

  // Keep @clerk/expo-passkeys in dependencies so the lockfile stays valid.
  pkg.expo = pkg.expo ?? {};
  pkg.expo.autolinking = pkg.expo.autolinking ?? {};
  const excl = new Set(pkg.expo.autolinking.exclude ?? []);
  excl.add("@clerk/expo-passkeys");
  pkg.expo.autolinking.exclude = [...excl];

  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(
    "[strip-clerk-passkeys] pre-install: kept package.json dep; set expo.autolinking.exclude",
  );
  process.exit(0);
}

const nm = join(root, "node_modules", "@clerk", "expo-passkeys");
if (existsSync(nm)) {
  rmSync(nm, { recursive: true, force: true });
  console.log(
    "[strip-clerk-passkeys] post-install: deleted node_modules/@clerk/expo-passkeys",
  );
} else {
  console.log(
    "[strip-clerk-passkeys] post-install: node_modules/@clerk/expo-passkeys already absent",
  );
}
