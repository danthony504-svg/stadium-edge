import { test } from "node:test";
import assert from "node:assert/strict";

import {
  friendlyInjury,
  injuryImpact,
  positionGroup,
  summarizeTeamInjuries,
  injuryEdge,
} from "./injuries.ts";
import type { InjuryTeam } from "./api.ts";

const entry = (player: string, position: string | null, status: string) => ({
  player,
  position,
  status,
  description: "",
});

test("friendlyInjury maps long-term IL to a casual label", () => {
  const r = friendlyInjury("60-Day-IL");
  assert.equal(r.label, "Out Long-Term");
  assert.equal(r.tier, "long");
  assert.equal(r.severity, 3);
});

test("friendlyInjury maps short IL to Out", () => {
  assert.equal(friendlyInjury("10-Day-IL").label, "Out");
  assert.equal(friendlyInjury("15-Day-IL").severity, 2);
});

test("friendlyInjury maps day-to-day to Questionable", () => {
  const r = friendlyInjury("Day-To-Day");
  assert.equal(r.label, "Questionable");
  assert.equal(r.severity, 1);
});

test("friendlyInjury treats bereavement as a short, low-severity absence", () => {
  const r = friendlyInjury("Bereavement");
  assert.equal(r.label, "Unavailable");
  assert.equal(r.severity, 1);
});

test("friendlyInjury treats probable as effectively available", () => {
  assert.equal(friendlyInjury("Probable").severity, 0);
});

test("friendlyInjury falls back to ESPN wording for unknown statuses", () => {
  assert.equal(friendlyInjury("Foo Bar").label, "Foo Bar");
});

test("injuryImpact rates an MLB starter out long-term as high impact", () => {
  assert.equal(injuryImpact("mlb", entry("Corbin Burnes", "SP", "60-Day-IL")).tier, "high");
});

test("injuryImpact rates a reliever on bereavement as low impact", () => {
  assert.equal(injuryImpact("mlb", entry("Taylor Clarke", "RP", "Bereavement")).tier, "low");
});

test("injuryImpact treats an available player as no impact", () => {
  const r = injuryImpact("mlb", entry("X", "SP", "Probable"));
  assert.equal(r.tier, "none");
  assert.equal(r.score, 0);
});

test("positionGroup buckets MLB positions into SP / RP / Batters", () => {
  assert.equal(positionGroup("mlb", "SP"), "SP");
  assert.equal(positionGroup("mlb", "RP"), "RP");
  assert.equal(positionGroup("mlb", "LF"), "Batters");
});

const hurt: InjuryTeam = {
  team: "Arizona Diamondbacks",
  teamAbbr: "ARI",
  entries: [
    entry("A", "SP", "60-Day-IL"),
    entry("B", "SP", "60-Day-IL"),
    entry("C", "RP", "Bereavement"),
  ],
};
const healthy: InjuryTeam = {
  team: "Washington Nationals",
  teamAbbr: "WSH",
  entries: [entry("D", "RP", "Day-To-Day")],
};

test("summarizeTeamInjuries counts high-impact injuries and position groups", () => {
  const s = summarizeTeamInjuries("mlb", hurt);
  assert.equal(s.highCount, 2);
  assert.equal(s.groups.find((g) => g.group === "SP")?.count, 2);
  assert.equal(s.groups.find((g) => g.group === "RP")?.count, 1);
});

test("injuryEdge awards the edge to the less-injured team", () => {
  const summaries = [hurt, healthy].map((t) => summarizeTeamInjuries("mlb", t));
  const edge = injuryEdge(summaries);
  assert.equal(edge.kind, "advantage");
  if (edge.kind === "advantage") {
    assert.equal(edge.team, "Washington Nationals");
    assert.equal(edge.opp, "Arizona Diamondbacks");
  }
});

test("injuryEdge returns even when impact is comparable", () => {
  const summaries = [healthy, { ...healthy, team: "Other" }].map((t) =>
    summarizeTeamInjuries("mlb", t),
  );
  assert.equal(injuryEdge(summaries).kind, "even");
});
