// Test-only module-resolution shim for coach-types package tests.
import module from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

module.registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL || "";

    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      if (specifier.endsWith(".js")) {
        const jsUrl = new URL(specifier, parent);
        if (!existsSync(fileURLToPath(jsUrl))) {
          const tsUrl = new URL(specifier.replace(/\.js$/, ".ts"), parent);
          if (existsSync(fileURLToPath(tsUrl))) {
            return { url: tsUrl.href, shortCircuit: true };
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
