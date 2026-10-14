import module from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

module.registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL || "";

    if (specifier.startsWith("@workspace/coach-types")) {
      const sub = specifier.replace("@workspace/coach-types", "");
      const suffix = sub && sub !== "/" ? sub : "/src/index.ts";
      const target = new URL(`../../coach-types${suffix.startsWith("/") ? suffix : `/${suffix}`}`, import.meta.url);
      return { url: target.href, shortCircuit: true };
    }

    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      if (!/\.[a-z]+$/i.test(specifier)) {
        const tsUrl = new URL(`${specifier}.ts`, parent);
        if (existsSync(fileURLToPath(tsUrl))) {
          return { url: tsUrl.href, shortCircuit: true };
        }
        const indexUrl = new URL(`${specifier}/index.ts`, parent);
        if (existsSync(fileURLToPath(indexUrl))) {
          return { url: indexUrl.href, shortCircuit: true };
        }
      }
    }

    return nextResolve(specifier, context);
  },
});
