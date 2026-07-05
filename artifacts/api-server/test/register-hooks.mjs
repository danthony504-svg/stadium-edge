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
import { register } from "node:module";

const loaderUrl = new URL("./test-resolve-hooks.mjs", import.meta.url).href;

if (typeof module.registerHooks === "function") {
  const { resolve } = await import("./test-resolve-hooks.mjs");
  module.registerHooks({ resolve });
} else {
  register(loaderUrl, import.meta.url);
}
