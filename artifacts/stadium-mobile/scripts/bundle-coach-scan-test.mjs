import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const esbuild = require("/workspace/node_modules/.pnpm/esbuild@0.27.3/node_modules/esbuild");

const dir = dirname(fileURLToPath(import.meta.url));
const root = join(dir, "..");
const stubPickCard = join(dir, "stub-pickcard.mjs");
const stubModule = join(dir, "stub-module.mjs");
const stubFetch = join(dir, "expo-fetch-shim.mjs");

await esbuild.build({
  entryPoints: [join(root, "lib/coachLiveBoardScan.integration.test.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: "/tmp/coach-scan-test.mjs",
  plugins: [
    {
      name: "stadium-node-stubs",
      setup(build) {
        build.onResolve({ filter: /^@expo\/vector-icons/ }, () => ({ path: stubModule }));
        build.onResolve({ filter: /^react-native$/ }, () => ({ path: stubModule }));
        build.onResolve({ filter: /^expo\/fetch(\.js)?$/ }, () => ({ path: stubFetch }));
        build.onResolve({ filter: /PickCard\.tsx$/ }, () => ({ path: stubPickCard }));
        build.onResolve({ filter: /^@\/components\/PickCard$/ }, () => ({ path: stubPickCard }));
      },
    },
  ],
});

console.log("bundled /tmp/coach-scan-test.mjs");
