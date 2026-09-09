import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

/**
 * Anything statically imported by app/_layout.tsx is evaluated before React
 * renders and before any error boundary exists. A throw there is not a red
 * screen: expo-updates counts it as a failed launch, blacklists the update on
 * the device and rolls back to the embedded bundle, which is exactly how
 * build 75 got stranded. expo-updates itself is the riskiest such import —
 * its module scope calls requireNativeModule and parses the manifest — so it
 * must stay behind a dynamic import that runs after the first paint.
 */
const ROOT = process.cwd();
const ENTRY = join(ROOT, "app/_layout.tsx");
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

/** Only `import ... from "x"` / `export ... from "x"`; `import("x")` is deferred by Metro. */
const STATIC_IMPORT =
  /(?:^|\n)\s*(?:import\s[^;]*?from\s*|import\s*|export\s[^;]*?from\s*)["']([^"']+)["']/g;

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

/** Every static-import chain from the entry that ends at `pkg`. */
function chainsReaching(pkg: string): string[] {
  const visited = new Set<string>();
  const chains: string[] = [];

  const walk = (file: string, trail: string[]) => {
    if (visited.has(file)) return;
    visited.add(file);

    const source = readFileSync(file, "utf8");
    STATIC_IMPORT.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = STATIC_IMPORT.exec(source))) {
      const spec = match[1];
      if (spec === pkg || spec.startsWith(`${pkg}/`)) {
        const chain = [...trail, file].map((f) => f.slice(ROOT.length + 1));
        chains.push(`${chain.join(" -> ")} -> ${spec}`);
        continue;
      }
      const next = resolveLocal(spec, file);
      if (next) walk(next, [...trail, file]);
    }
  };

  walk(ENTRY, []);
  return [...new Set(chains)];
}

test("root bundle evaluation never reaches expo-updates", () => {
  const chains = chainsReaching("expo-updates");
  assert.deepEqual(
    chains,
    [],
    `expo-updates must be loaded after first paint (see components/DeferredOtaRuntime.tsx):\n${chains.join("\n")}`,
  );
});

test("the deferred runtime is what pulls expo-updates in", () => {
  const deferred = readFileSync(join(ROOT, "components/DeferredOtaRuntime.tsx"), "utf8");
  assert.match(
    deferred,
    /lazy\(\(\) => import\("@\/components\/OtaRuntime"\)\)/,
    "OtaRuntime must stay behind a dynamic import",
  );

  const runtime = readFileSync(join(ROOT, "components/OtaRuntime.tsx"), "utf8");
  assert.match(runtime, /from "@\/lib\/otaUpdater"/, "OtaRuntime should own the updater hook");
});
