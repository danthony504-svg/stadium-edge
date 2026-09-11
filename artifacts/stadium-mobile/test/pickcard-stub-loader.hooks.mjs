import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const stubUrl = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "fakes/PickCardStub.ts"),
).href;

export async function resolve(specifier, context, nextResolve) {
  if (
    specifier.endsWith("PickCard.tsx") ||
    specifier === "@/components/PickCard" ||
    /\/components\/PickCard$/.test(specifier)
  ) {
    return { url: stubUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
