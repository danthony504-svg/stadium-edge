import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { access } from "node:fs/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function resolveFile(basePath) {
  for (const ext of ["", ".ts", ".tsx", ".js", ".mjs"]) {
    const candidate = basePath + ext;
    try {
      await access(candidate);
      return pathToFileURL(candidate).href;
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (
    specifier === "@/components/PickCard" ||
    specifier.endsWith("components/PickCard.tsx") ||
    specifier.endsWith("PickCard.tsx")
  ) {
    return { url: new URL("./stub-pickcard.mjs", import.meta.url).href, shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    const url = await resolveFile(join(root, specifier.slice(2)));
    if (url) return { url, shortCircuit: true };
  }
  if (specifier === "expo/fetch" || specifier === "expo/fetch.js") {
    return { url: new URL("./expo-fetch-shim.mjs", import.meta.url).href, shortCircuit: true };
  }
  if (specifier === "@expo/vector-icons" || specifier.startsWith("@expo/vector-icons/")) {
    return { url: new URL("./stub-module.mjs", import.meta.url).href, shortCircuit: true };
  }
  if (specifier === "react-native") {
    return { url: new URL("./stub-module.mjs", import.meta.url).href, shortCircuit: true };
  }

  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !/\.[a-z]+$/i.test(specifier) &&
    context.parentURL
  ) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    const url = await resolveFile(join(parentDir, specifier));
    if (url) return { url, shortCircuit: true };
  }

  try {
    return await nextResolve(specifier, context);
  } catch (e) {
    if (
      e?.code === "ERR_MODULE_NOT_FOUND" &&
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !/\.[a-z]+$/i.test(specifier)
    ) {
      const parentDir = context.parentURL
        ? dirname(fileURLToPath(context.parentURL))
        : root;
      const url = await resolveFile(join(parentDir, specifier));
      if (url) return { url, shortCircuit: true };
      for (const ext of [".ts", ".tsx", ".js", ".mjs"]) {
        try {
          return await nextResolve(`${specifier}${ext}`, context);
        } catch {
          /* try next */
        }
      }
    }
    throw e;
  }
}
