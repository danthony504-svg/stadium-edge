/**
 * Benchmark-only module resolver: expo/fetch → global fetch, stub RN icon imports,
 * rewrite @/ and .js→.ts, and allow API_BASE override via BENCH_API_BASE.
 */
import module from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../stadium-mobile/", import.meta.url).href;
const FAKE_EXPO_FETCH = new URL(
  "../../stadium-mobile/test/fakes/expo-fetch.ts",
  import.meta.url,
).href;
const PICKCARD_STUB = new URL(
  "../../stadium-mobile/test/fakes/PickCardStub.ts",
  import.meta.url,
).href;
const SPORTS_STUB = new URL("./fakes/sportsStub.ts", import.meta.url).href;
const API_BASE_STUB = new URL("./fakes/apiBaseStub.ts", import.meta.url).href;

module.registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL || "";

    if (specifier === "expo/fetch" || specifier === "expo/fetch.js") {
      return { url: FAKE_EXPO_FETCH, shortCircuit: true };
    }

    if (
      specifier === "@/components/PickCard" ||
      specifier.endsWith("/components/PickCard") ||
      specifier.endsWith("PickCard.tsx")
    ) {
      return { url: PICKCARD_STUB, shortCircuit: true };
    }

    if (
      specifier === "@/lib/sports" ||
      specifier.endsWith("/lib/sports") ||
      specifier.endsWith("/lib/sports.ts")
    ) {
      return { url: SPORTS_STUB, shortCircuit: true };
    }

    if (
      specifier === "@/lib/apiBase" ||
      specifier.endsWith("/lib/apiBase") ||
      specifier.endsWith("/lib/apiBase.ts") ||
      specifier === "./apiBase" ||
      specifier === "./apiBase.ts"
    ) {
      return { url: API_BASE_STUB, shortCircuit: true };
    }

    if (specifier.startsWith("@expo/vector-icons")) {
      return { url: SPORTS_STUB, shortCircuit: true };
    }

    if (specifier.startsWith("@/")) {
      const rel = specifier.slice(2);
      const candidates = [
        new URL(`${rel}.ts`, ROOT),
        new URL(`${rel}.tsx`, ROOT),
        new URL(`${rel}/index.ts`, ROOT),
      ];
      for (const url of candidates) {
        if (existsSync(fileURLToPath(url))) {
          return { url: url.href, shortCircuit: true };
        }
      }
    }

    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      if (specifier.endsWith(".js")) {
        const jsUrl = new URL(specifier, parent);
        if (!existsSync(fileURLToPath(jsUrl))) {
          const tsUrl = new URL(specifier.replace(/\.js$/, ".ts"), parent);
          if (existsSync(fileURLToPath(tsUrl))) {
            return { url: tsUrl.href, shortCircuit: true };
          }
          const tsxUrl = new URL(specifier.replace(/\.js$/, ".tsx"), parent);
          if (existsSync(fileURLToPath(tsxUrl))) {
            return { url: tsxUrl.href, shortCircuit: true };
          }
        }
      } else if (!/\.[a-z]+$/i.test(specifier)) {
        const tsUrl = new URL(`${specifier}.ts`, parent);
        if (existsSync(fileURLToPath(tsUrl))) {
          return { url: tsUrl.href, shortCircuit: true };
        }
      }
    }

    return nextResolve(specifier, context);
  },
});
