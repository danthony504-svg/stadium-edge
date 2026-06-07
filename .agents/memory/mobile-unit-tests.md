---
name: stadium-mobile unit tests
description: How to add/run Node-native unit tests in artifacts/stadium-mobile (no jest/vitest)
---
The mobile artifact has NO test framework installed. Tests run on Node 24's native runner: `node --test 'lib/**/*.test.ts'` (script `test` in package.json). Node strips types and executes `.ts` directly.

**Gotchas:**
- Test imports MUST use the explicit `.ts` extension (Node's loader needs it; a `.js` extension fails because only the `.ts` exists). But plain `tsc` rejects `.ts` import paths unless `allowImportingTsExtensions: true` + `noEmit: true` are set in tsconfig.json — both are now set. Expo bundles via metro/babel (not tsc) so these flags only affect typecheck, which is safe.
- `lib/api.ts` imports `expo/fetch` at the top, so it can NOT be imported in a plain Node test. To unit-test logic that lives in api.ts, extract the PURE part into a dependency-free module (pattern: `lib/chatContextPriority.ts`) and re-export from api.ts so existing callers keep working.

**Why:** locking in Coach behavior (e.g. focal-game player-stat prioritization survives the 40-player game-log cap) needs a test, but the whole api.ts module can't load under Node.
