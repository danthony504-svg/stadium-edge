/**
 * Redirects PickCard.tsx value imports to a TS stub so delivery/kernel tests
 * can run under Node 22 + --experimental-strip-types.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "pickcard-stub-loader.hooks.mjs")).href, import.meta.url);
