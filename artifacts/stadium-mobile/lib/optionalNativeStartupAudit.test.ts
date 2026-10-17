/**
 * Startup compatibility audit: optional native modules must not be required
 * at RootLayout evaluation when the binary lacks them (Build 78 / OTA tip
 * 01a14b8b ClerkExpoPasskeys abort).
 *
 * Scans cold-start graph + known optional-native loaders for unguarded requires.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const LAYOUT = join(ROOT, "app/_layout.tsx");
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

const STATIC_IMPORT =
  /(?:^|\n)\s*(?:import\s[^;]*?from\s*|import\s*|export\s[^;]*?from\s*)["']([^"']+)["']/g;

/** Packages whose module-eval calls requireNativeModule and abort ErrorRecovery. */
const HARD_NATIVE_PACKAGES = [
  "@clerk/expo/passkeys",
  "react-native-purchases",
] as const;

function resolveLocal(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;

  for (const ext of ["", ...EXTENSIONS]) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  for (const ext of EXTENSIONS) {
    const candidate = join(base, `index${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function staticSpecsFrom(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const out: string[] = [];
  STATIC_IMPORT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STATIC_IMPORT.exec(source))) out.push(match[1]!);
  return out;
}

/** Walk static imports from entry; collect package specs. */
function coldStartPackageSpecs(entry: string): Set<string> {
  const visited = new Set<string>();
  const pkgs = new Set<string>();

  const walk = (file: string) => {
    if (visited.has(file)) return;
    visited.add(file);
    for (const spec of staticSpecsFrom(file)) {
      if (spec.startsWith(".") || spec.startsWith("@/")) {
        const next = resolveLocal(spec, file);
        if (next) walk(next);
      } else {
        pkgs.add(spec);
      }
    }
  };

  walk(entry);
  return pkgs;
}

test("RootLayout never statically imports hard-native optional packages", () => {
  const pkgs = coldStartPackageSpecs(LAYOUT);
  for (const pkg of HARD_NATIVE_PACKAGES) {
    assert.equal(
      pkgs.has(pkg),
      false,
      `app/_layout.tsx cold-start graph must not static-import ${pkg}`,
    );
  }
  // Clerk core is fine; only the passkeys subpath is fatal without native.
  assert.ok(
    [...pkgs].some((p) => p === "@clerk/expo" || p.startsWith("@clerk/expo/")),
    "ClerkProvider path should still reach @clerk/expo",
  );
  assert.equal(pkgs.has("@clerk/expo/passkeys"), false);
});

test("passkeyAuth guards require(@clerk/expo/passkeys) behind native presence", () => {
  const src = readFileSync(join(ROOT, "lib/passkeyAuth.ts"), "utf8");
  assert.match(src, /export function hasClerkExpoPasskeysNative/);
  assert.match(src, /requireOptionalNativeModule\("ClerkExpoPasskeys"\)/);

  // Loader: native check must precede the hard require (ignore comment mentions).
  const loaderIdx = src.indexOf("function defaultPasskeysLoader");
  assert.ok(loaderIdx >= 0);
  const loaderBody = src.slice(loaderIdx);
  const requireMatch = loaderBody.match(
    /return\s+require\(["']@clerk\/expo\/passkeys["']\)/,
  );
  assert.ok(requireMatch, "defaultPasskeysLoader must require @clerk/expo/passkeys");
  const requireAt = requireMatch.index ?? -1;
  assert.match(
    loaderBody.slice(0, requireAt),
    /hasClerkExpoPasskeysNative/,
    "defaultPasskeysLoader must check native presence before require",
  );

  // getPasskeys: short-circuit before invoking loader/require at all.
  const getIdx = src.indexOf("export function getPasskeys");
  const getEnd = src.indexOf("export function isPasskeysSupported", getIdx);
  assert.ok(getIdx >= 0 && getEnd > getIdx);
  assert.match(
    src.slice(getIdx, getEnd),
    /if \(!hasClerkExpoPasskeysNative\(\)\)/,
    "getPasskeys must return null before loader when native absent",
  );
});

test("purchases guards require(react-native-purchases) behind RNPurchases", () => {
  const src = readFileSync(join(ROOT, "lib/purchases.ts"), "utf8");
  assert.match(src, /export function hasPurchasesNativeModule/);
  const loadIdx = src.indexOf("function loadPurchases");
  assert.ok(loadIdx >= 0);
  const loadBody = src.slice(loadIdx);
  const requireMatch = loadBody.match(
    /require\(["']react-native-purchases["']\)/,
  );
  assert.ok(requireMatch, "loadPurchases must require react-native-purchases");
  const requireAt = requireMatch.index ?? -1;
  assert.match(
    loadBody.slice(0, requireAt),
    /hasPurchasesNativeModule/,
    "loadPurchases must check hasPurchasesNativeModule before require",
  );
});

test("expo-updates stays behind tryGetExpoUpdates / deferred runtime (not RootLayout static)", () => {
  const pkgs = coldStartPackageSpecs(LAYOUT);
  assert.equal(pkgs.has("expo-updates"), false);
  const access = readFileSync(join(ROOT, "lib/expoUpdatesAccess.ts"), "utf8");
  assert.match(access, /export function tryGetExpoUpdates/);
  assert.match(access, /require\("expo-updates"\)/);
});

test("no new unguarded requireNativeModule hard-crash patterns in lib/", () => {
  // Flag lib files that require known hard-native packages without a preceding
  // has*Native / tryGet / requireOptionalNativeModule guard in the same file.
  const libDir = join(ROOT, "lib");
  const files = readdirSync(libDir)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));

  const findings: string[] = [];
  for (const f of files) {
    const src = readFileSync(join(libDir, f), "utf8");
    for (const pkg of HARD_NATIVE_PACKAGES) {
      if (!src.includes(`require("${pkg}")`) && !src.includes(`require('${pkg}')`)) {
        continue;
      }
      const hasGuard =
        /hasClerkExpoPasskeysNative|hasPurchasesNativeModule|requireOptionalNativeModule/.test(
          src,
        );
      if (!hasGuard) {
        findings.push(`${f}: require(${pkg}) without native presence guard`);
      }
    }
  }
  assert.deepEqual(findings, [], findings.join("\n"));
});
