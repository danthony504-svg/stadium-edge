#!/usr/bin/env node
/**
 * EAS pre-install hook helper for profile `preview-build78`.
 * When EXPO_NO_CLERK_PASSKEYS=1, remove @clerk/expo-passkeys from package.json
 * dependencies and pin expo.autolinking.exclude so ClerkExpoPasskeys is not
 * linked — matching Build 78 (passkeys package was not in that native binary).
 *
 * Other native deps (ClerkExpo, RevenueCat, expo-updates, etc.) stay as-is.
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const enabled = String(process.env.EXPO_NO_CLERK_PASSKEYS ?? "") === "1";

if (!enabled) {
  console.log("[strip-clerk-passkeys] EXPO_NO_CLERK_PASSKEYS!=1 — no-op");
  process.exit(0);
}

const pkgPath = join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
let changed = false;

if (pkg.dependencies?.["@clerk/expo-passkeys"]) {
  delete pkg.dependencies["@clerk/expo-passkeys"];
  changed = true;
}
if (pkg.devDependencies?.["@clerk/expo-passkeys"]) {
  delete pkg.devDependencies["@clerk/expo-passkeys"];
  changed = true;
}

pkg.expo = pkg.expo ?? {};
pkg.expo.autolinking = pkg.expo.autolinking ?? {};
const excl = new Set(pkg.expo.autolinking.exclude ?? []);
excl.add("@clerk/expo-passkeys");
pkg.expo.autolinking.exclude = [...excl];

if (changed || true) {
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(
    "[strip-clerk-passkeys] removed @clerk/expo-passkeys; autolinking.exclude updated",
  );
}

// Drop installed module if present so autolinking cannot rediscover it.
const nm = join(root, "node_modules", "@clerk", "expo-passkeys");
if (existsSync(nm)) {
  rmSync(nm, { recursive: true, force: true });
  console.log("[strip-clerk-passkeys] deleted node_modules/@clerk/expo-passkeys");
}
