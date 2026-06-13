// Test-only module-resolution shim, loaded via `node --import`. It does NOT
// touch production code; it only adjusts how the test process resolves imports.
//
// Two jobs:
//  1. Generic `.js` -> `.ts` rewrite for relative specifiers. The codebase
//     follows the NodeNext convention of writing `.js` in import specifiers even
//     though the files on disk are `.ts`. esbuild handles that in the real
//     build, but node's native test runner does not, so we map a relative
//     `*.js` to its sibling `*.ts` when only the `.ts` exists.
//  2. Redirect coachBuild.ts's external dependencies (`@workspace/db`,
//     `./push.js`, `drizzle-orm`) to the in-memory fakes under ./fakes, so the
//     stash/notify/dedupe DB interactions can be asserted without a real
//     Postgres, a live Expo push, or DATABASE_URL.
import module from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FAKE_DB = new URL("./fakes/db.ts", import.meta.url).href;
const FAKE_PUSH = new URL("./fakes/push.ts", import.meta.url).href;
const FAKE_DRIZZLE = new URL("./fakes/drizzle.ts", import.meta.url).href;

module.registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL || "";

    // Scope the fake redirects strictly to the module under test so other
    // (current or future) suites keep using the real modules.
    if (parent.endsWith("/coachBuild.ts")) {
      if (specifier === "@workspace/db") {
        return { url: FAKE_DB, shortCircuit: true };
      }
      if (specifier === "./push.js") {
        return { url: FAKE_PUSH, shortCircuit: true };
      }
      if (specifier === "drizzle-orm") {
        return { url: FAKE_DRIZZLE, shortCircuit: true };
      }
    }

    // Generic relative `.js` -> `.ts` fallback.
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js")) {
      const jsUrl = new URL(specifier, parent);
      if (!existsSync(fileURLToPath(jsUrl))) {
        const tsUrl = new URL(specifier.replace(/\.js$/, ".ts"), parent);
        if (existsSync(fileURLToPath(tsUrl))) {
          return { url: tsUrl.href, shortCircuit: true };
        }
      }
    }

    return nextResolve(specifier, context);
  },
});
