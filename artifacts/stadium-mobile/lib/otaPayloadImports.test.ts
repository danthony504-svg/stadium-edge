import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * `@expo/vector-icons` and `@expo-google-fonts/*` barrels `require()` every font
 * they ship, so a single barrel import pulls all 19 icon sets or all 18 Inter
 * weights into the OTA payload (~7.75 MB of unused TTFs). Only the per-family /
 * per-weight subpaths keep the published update small.
 */
const BARRELS = [
  '"@expo/vector-icons"',
  '"@expo-google-fonts/inter"',
  '"@expo-google-fonts/bricolage-grotesque"',
];

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "lib", "components", "context", "hooks"];
const SOURCE_EXT = /\.(ts|tsx)$/;

function sourceFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (SOURCE_EXT.test(entry)) out.push(full);
  }
  return out;
}

test("no source file imports icon or font barrels", () => {
  const files = SCAN_DIRS.flatMap((d) => sourceFiles(join(ROOT, d)));
  assert.ok(files.length > 100, `expected to scan the app sources, saw ${files.length}`);

  const offenders: string[] = [];
  for (const file of files) {
    if (file.endsWith("otaPayloadImports.test.ts")) continue;
    const src = readFileSync(file, "utf8");
    for (const barrel of BARRELS) {
      if (src.includes(`from ${barrel}`)) {
        offenders.push(`${file.slice(ROOT.length + 1)} -> ${barrel}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `import the exact subpath instead (e.g. "@expo/vector-icons/Feather", "@expo-google-fonts/inter/400Regular"):\n${offenders.join("\n")}`,
  );
});
