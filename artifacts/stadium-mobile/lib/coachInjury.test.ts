import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { InjuryTeam } from "./coachInjury.ts";
import {
  COACH_INJURY_TIMEOUT_MS,
  fetchCoachInjuriesForBuild,
  resetCoachInjuryForTests,
  setCoachInjurySportFetcherForTests,
} from "./coachInjury.ts";
import { coachBuildWorkflowIndex, beginCoachFinalizeRequest, getCoachFinalizeRecord, markCoachLineValueReady } from "./coachFinalize.ts";

const sampleTeams: InjuryTeam[] = [
  {
    team: "Los Angeles Lakers",
    teamAbbr: "LAL",
    entries: [
      {
        player: "LeBron James",
        position: "F",
        status: "Out",
        description: "Ankle",
      },
    ],
  },
];

describe("coachInjury", () => {
  test("normal injury response advances workflow past 40%", async () => {
    resetCoachInjuryForTests();
    setCoachInjurySportFetcherForTests(async () => sampleTeams);
    beginCoachFinalizeRequest("req-ok", 5);

    const result = await fetchCoachInjuriesForBuild({
      requestId: "req-ok",
      sports: ["nba"],
    });

    assert.equal(result.record.injuryStatus, "available");
    assert.equal(result.record.step, "complete");
    assert.ok(result.injuryTeams.length > 0);
    assert.equal(
      coachBuildWorkflowIndex(getCoachFinalizeRecord("req-ok"), result.record),
      4,
    );

    markCoachLineValueReady("req-ok");
    assert.equal(
      coachBuildWorkflowIndex(getCoachFinalizeRecord("req-ok"), result.record),
      6,
    );
    setCoachInjurySportFetcherForTests(null);
  });

  test("forced timeout continues with unavailable injury data", async () => {
    resetCoachInjuryForTests();
    setCoachInjurySportFetcherForTests(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(sampleTeams), COACH_INJURY_TIMEOUT_MS + 500);
        }),
    );
    beginCoachFinalizeRequest("req-timeout", 5);

    const result = await fetchCoachInjuriesForBuild({
      requestId: "req-timeout",
      sports: ["nba"],
    });

    assert.equal(result.record.injuryStatus, "unavailable");
    assert.equal(result.record.step, "unavailable");
    assert.equal(result.injuryTeams.length, 0);
    assert.equal(
      coachBuildWorkflowIndex(getCoachFinalizeRecord("req-timeout"), result.record),
      4,
    );
    setCoachInjurySportFetcherForTests(null);
  });

  test("empty response is non-blocking and advances workflow", async () => {
    resetCoachInjuryForTests();
    setCoachInjurySportFetcherForTests(async () => []);
    beginCoachFinalizeRequest("req-empty", 5);

    const result = await fetchCoachInjuriesForBuild({
      requestId: "req-empty",
      sports: ["nba"],
    });

    assert.equal(result.record.injuryStatus, "unavailable");
    assert.equal(result.record.step, "skipped");
    assert.equal(
      coachBuildWorkflowIndex(getCoachFinalizeRecord("req-empty"), result.record),
      4,
    );
    setCoachInjurySportFetcherForTests(null);
  });

  test("duplicate requestId resumes in-flight fetch instead of restarting", async () => {
    resetCoachInjuryForTests();
    let calls = 0;
    setCoachInjurySportFetcherForTests(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return sampleTeams;
    });

    const p1 = fetchCoachInjuriesForBuild({ requestId: "req-dedupe", sports: ["nba"] });
    const p2 = fetchCoachInjuriesForBuild({ requestId: "req-dedupe", sports: ["nba"] });
    const [a, b] = await Promise.all([p1, p2]);
    assert.equal(calls, 1);
    assert.equal(a.record.requestId, b.record.requestId);
    setCoachInjurySportFetcherForTests(null);
  });
});
