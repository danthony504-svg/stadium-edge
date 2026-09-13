import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("ESPN soccer scoreboards cover Odds soccer league families (source)", () => {
  const sports = readFileSync(join(root, "src/lib/sports.ts"), "utf8");
  const games = readFileSync(join(root, "src/routes/games.ts"), "utf8");

  assert.match(sports, /soccer_france_ligue_one/);
  assert.match(sports, /soccer_brazil_campeonato/);
  assert.match(sports, /soccer_japan_j_league/);
  assert.match(sports, /soccer_italy_serie_b/);
  assert.match(sports, /soccer_spain_segunda_division/);

  // Scoreboard merge must include club leagues beyond UCL + WC — otherwise
  // Coach phones TEAM_IDS_UNRESOLVED for Ligue 1 / Brazil / etc.
  for (const path of [
    "soccer/fra.1",
    "soccer/bra.1",
    "soccer/jpn.1",
    "soccer/ita.2",
    "soccer/esp.2",
    "soccer/uefa.champions",
    "soccer/fifa.world",
  ]) {
    assert.match(sports, new RegExp(path.replace(".", "\\.")));
  }
  assert.match(games, /ESPN_SOCCER_SCOREBOARD_PATHS/);
  assert.match(games, /sportId === "soccer"/);
});
