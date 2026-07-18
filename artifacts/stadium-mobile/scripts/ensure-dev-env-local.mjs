#!/usr/bin/env node
/**
 * Writes .env.local from eas.json development profile + current git HEAD.
 * Expo loads .env.local automatically for `npx expo start --dev-client`.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const eas = JSON.parse(readFileSync(join(root, "eas.json"), "utf8"));
const devEnv = eas.build?.development?.env ?? {};
const repoRoot = join(root, "../..");
const commit = execSync(`git -C "${repoRoot}" rev-parse HEAD`, { encoding: "utf8" }).trim();
const lines = [
  ...Object.entries(devEnv).map(([k, v]) => `${k}=${v}`),
  `EXPO_PUBLIC_GIT_COMMIT=${commit}`,
];
writeFileSync(join(root, ".env.local"), `${lines.join("\n")}\n`);
const keys = lines.map((l) => l.split("=")[0]);
console.log(`Wrote .env.local (${keys.join(", ")})`);
