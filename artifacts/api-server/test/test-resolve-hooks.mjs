// Resolve hook for node:test — loaded via register() from register-hooks.mjs.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FAKE_DB = new URL("./fakes/db.ts", import.meta.url).href;
const FAKE_PUSH = new URL("./fakes/push.ts", import.meta.url).href;
const FAKE_DRIZZLE = new URL("./fakes/drizzle.ts", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL || "";

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
}
