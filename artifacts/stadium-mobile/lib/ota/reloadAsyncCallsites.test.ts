/**
 * Prove every reloadAsync callsite in the mobile app and classify it.
 * Production reload must be reachable only via OtaController.restart().
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const ROOT = process.cwd();

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".expo",
  "coverage",
  "ios",
  "android",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

test("every reloadAsync callsite is classified; production only via OtaController.restart", () => {
  const files = walk(ROOT);
  const hits: { file: string; line: number; text: string }[] = [];

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    lines.forEach((text, i) => {
      if (!/reloadAsync\s*\(/.test(text)) return;
      const trimmed = text.trim();
      // Skip comments / JSX labels / prose that merely mention the API name.
      if (
        trimmed.startsWith("//") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("/*") ||
        /label=["']reloadAsync/.test(trimmed) ||
        /`reloadAsync/.test(trimmed) ||
        /["']reloadAsync\("?\)["']/.test(trimmed)
      ) {
        return;
      }
      hits.push({
        file: relative(ROOT, file),
        line: i + 1,
        text: trimmed,
      });
    });
  }

  const allowed = [
    // New controller — sole production path.
    "lib/ota/OtaController.ts",
    "lib/ota/createExpoOtaClient.ts",
    // Legacy core kept for unit tests of old pure helpers (not mounted).
    "lib/otaUpdaterCore.ts",
    // Diagnostics-only explicit button path.
    "lib/otaLaunch.ts",
    // Type / interface declarations.
    "lib/ota/types.ts",
  ];

  const forbiddenProduction = [
    "components/OtaUpdateBanner.tsx",
    "components/OtaRequiredGate.tsx",
    "components/ErrorFallback.tsx",
    "lib/otaUpdater.ts",
    "lib/otaAutoApply.ts",
    "components/OtaRuntime.tsx",
  ];

  for (const f of forbiddenProduction) {
    assert.equal(
      hits.some((h) => h.file === f),
      false,
      `${f} must not call reloadAsync (hits=${JSON.stringify(
        hits.filter((h) => h.file === f),
      )})`,
    );
  }

  for (const hit of hits) {
    const ok =
      allowed.some((a) => hit.file === a) ||
      hit.file.startsWith("lib/ota/") ||
      // Interface-only lines in types
      /reloadAsync\s*:\s*/.test(hit.text) ||
      /Pick<.*reloadAsync/.test(hit.text);
    assert.ok(
      ok,
      `Unclassified reloadAsync callsite: ${hit.file}:${hit.line} :: ${hit.text}`,
    );
  }

  // Banner must call controller restart, not Updates.reloadAsync.
  const banner = readFileSync(join(ROOT, "components/OtaUpdateBanner.tsx"), "utf8");
  assert.match(banner, /onRestart/);
  assert.doesNotMatch(banner, /Updates\.reloadAsync|reloadAsync\s*\(/);

  const runtime = readFileSync(join(ROOT, "components/OtaRuntime.tsx"), "utf8");
  assert.match(runtime, /useOtaController/);
  assert.match(runtime, /restart/);
  assert.doesNotMatch(runtime.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, ""), /useOtaUpdater/);

  const controller = readFileSync(join(ROOT, "lib/ota/OtaController.ts"), "utf8");
  assert.match(controller, /async restart\(/);
  assert.match(controller, /this\.client\.reloadAsync\(\)/);
  // No automatic reload invocation outside restart().
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const bootFn = stripComments(
    controller.slice(controller.indexOf("boot():"), controller.indexOf("async onForeground")),
  );
  assert.doesNotMatch(bootFn, /\.reloadAsync\s*\(/);
  const onFgFn = stripComments(
    controller.slice(
      controller.indexOf("async onForeground"),
      controller.indexOf("async check("),
    ),
  );
  assert.doesNotMatch(onFgFn, /\.reloadAsync\s*\(/);
  const checkFn = stripComments(
    controller.slice(controller.indexOf("async check("), controller.indexOf("async restart(")),
  );
  assert.doesNotMatch(checkFn, /\.reloadAsync\s*\(/);
  const restartFn = controller.slice(controller.indexOf("async restart("));
  assert.match(restartFn, /this\.client\.reloadAsync\(\)/);
});
