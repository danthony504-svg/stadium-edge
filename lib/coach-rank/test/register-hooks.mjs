import module from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PKG_ROOT = {
  "@workspace/coach-types": "../../coach-types",
  "@workspace/coach-learn": "../../coach-learn",
};

module.registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL || "";

    for (const [pkg, root] of Object.entries(PKG_ROOT)) {
      if (specifier === pkg || specifier.startsWith(`${pkg}/`)) {
        const sub = specifier === pkg ? "/src/index.ts" : specifier.slice(pkg.length);
        const rel = sub.startsWith("/") ? sub.slice(1) : sub;
        const target = new URL(`${root}/${rel.endsWith(".ts") ? rel : `${rel}.ts`}`, import.meta.url);
        if (existsSync(fileURLToPath(target))) {
          return { url: target.href, shortCircuit: true };
        }
        const indexTarget = new URL(`${root}/${rel}/index.ts`, import.meta.url);
        if (existsSync(fileURLToPath(indexTarget))) {
          return { url: indexTarget.href, shortCircuit: true };
        }
      }
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
