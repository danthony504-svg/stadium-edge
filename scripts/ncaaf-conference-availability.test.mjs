import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  availabilityStatus,
  publicationTime,
  buildConferenceArchive,
  bindConferenceReports,
  decodeCapture,
} from "./ncaaf-conference-availability.mjs";
const now = "2026-10-24T03:00:00Z";
const receipt = (body) => ({
  requestStartedAt: "2026-10-24T02:59:00Z",
  receivedAt: now,
  rawResponse: JSON.stringify(body),
});
function fixture() {
  const p = {
    3300: {
      ReportType: "Update 2",
      publishDate: "2026-10-23",
      postedTime: "19:00:00",
      conferenceTimeZone: "CT",
      games: [
        {
          teamName: "Indiana",
          rows: [{ name: "QB #1 Player A", status: "Exempt" }],
        },
        {
          teamName: "Michigan",
          rows: [{ name: "QB #2 Player B", status: "Available" }],
        },
      ],
    },
  };
  const h = {
    data: [
      {
        Team: "Indiana",
        Opponent: "Michigan",
        Week: "Sat, 24 Oct 2026 00:00:00 GMT",
      },
      {
        Team: "Michigan",
        Opponent: "at Indiana",
        Week: "Sat, 24 Oct 2026 00:00:00 GMT",
      },
    ],
  };
  const target = {
    eventId: "123",
    season: 2026,
    homeId: "1",
    awayId: "2",
    kickoff: "2026-10-24T16:00:00Z",
  };
  const rawResponse = JSON.stringify({
    events: [
      {
        id: "123",
        season: { year: 2026 },
        competitions: [
          {
            date: target.kickoff,
            status: { type: { state: "pre" } },
            competitors: [
              { homeAway: "home", team: { id: "1", location: "Indiana" } },
              { homeAway: "away", team: { id: "2", location: "Michigan" } },
            ],
          },
        ],
      },
    ],
  });
  const sha256 = createHash("sha256").update(rawResponse).digest("hex");
  const live = {
    researchOnly: true,
    scoreboards: [{ rawResponse, sha256, receivedAt: now }],
    matched: [
      {
        target: {
          ...target,
          scoreboardSha256: sha256,
          scoreboardObservedAt: now,
        },
      },
    ],
  };
  return {
    p,
    h,
    live,
    archive: buildConferenceArchive("B10", receipt(p), receipt(h)),
  };
}
test("published CT/ET timestamps use date-specific offsets, invalid clocks reject", () => {
  assert.equal(
    publicationTime({
      publishDate: "2026-10-23",
      postedTime: "19:00:00",
      conferenceTimeZone: "CT",
    }),
    "2026-10-24T00:00:00.000Z",
  );
  assert.equal(
    publicationTime({
      publishDate: "2026-12-23",
      postedTime: "19:00:00",
      conferenceTimeZone: "ET",
    }),
    "2026-12-24T00:00:00.000Z",
  );
  assert.throws(() =>
    publicationTime({
      publishDate: "2026-02-30",
      postedTime: "19:00:00",
      conferenceTimeZone: "CT",
    }),
  );
});
test("raw responses round-trip with hashes; exempt and unrecognized statuses remain unknown", () => {
  const { archive, p } = fixture();
  assert.deepEqual(decodeCapture(archive.published), p);
  assert.equal(archive.reports[0].sides[0].rows[0].status, "unknown");
  assert.equal(availabilityStatus("Healthy"), "unknown");
  assert.equal(availabilityStatus("constructor"), "unknown");
  assert.equal(availabilityStatus("Out"), "out");
  assert.equal(archive.releaseEligible, false);
  assert.equal(archive.historicalAvailabilityVerified, false);
  assert.throws(() =>
    decodeCapture({ ...archive.published, sha256: "0".repeat(64) }),
  );
});
test("both source sides plus unique source day bind exact ESPN identities before kickoff", () => {
  const { archive, live } = fixture(),
    copy = structuredClone(live);
  const b = bindConferenceReports(archive, live, now);
  assert.equal(b[0].eventBindingVerified, true);
  assert.equal(b[0].target.eventId, "123");
  assert.equal(b[0].releaseEligible, false);
  assert.deepEqual(live, copy);
});
test("missing reciprocal dates, duplicate dates, reversed or ambiguous identities do not bind", () => {
  const { p, h, live } = fixture();
  assert.equal(
    bindConferenceReports(
      buildConferenceArchive(
        "B10",
        receipt(p),
        receipt({ data: h.data.slice(0, 1) }),
      ),
      live,
      now,
    )[0].eventBindingVerified,
    false,
  );
  const two = {
    data: [
      ...h.data,
      ...h.data.map((r) => ({ ...r, Week: "Sun, 25 Oct 2026 00:00:00 GMT" })),
    ],
  };
  assert.equal(
    bindConferenceReports(
      buildConferenceArchive("B10", receipt(p), receipt(two)),
      live,
      now,
    )[0].eventBindingVerified,
    false,
  );
  const dup = structuredClone(live);
  dup.scoreboards.push(dup.scoreboards[0]);
  assert.equal(
    bindConferenceReports(
      buildConferenceArchive("B10", receipt(p), receipt(h)),
      dup,
      now,
    )[0].eventBindingVerified,
    false,
  );
  const reversed = structuredClone(live);
  reversed.matched[0].target.homeId = "2";
  assert.equal(
    bindConferenceReports(
      buildConferenceArchive("B10", receipt(p), receipt(h)),
      reversed,
      now,
    )[0].eventBindingVerified,
    false,
  );
});
test("future publication, future receipts, changed raw bytes, started games and stale captures reject or withhold", () => {
  const { p, h, archive, live } = fixture();
  const future = structuredClone(p);
  future["3300"].postedTime = "23:00:00";
  assert.throws(() =>
    buildConferenceArchive("B10", receipt(future), receipt(h)),
  );
  assert.throws(() =>
    bindConferenceReports(archive, live, "2026-10-24T02:00:00Z"),
  );
  assert.throws(() =>
    bindConferenceReports(archive, live, "2026-10-24T10:00:00Z"),
  );
  const corrupt = structuredClone(live);
  corrupt.scoreboards[0].rawResponse += " ";
  assert.throws(() => bindConferenceReports(archive, corrupt, now));
  const started = structuredClone(live);
  started.matched[0].target.kickoff = "2026-10-24T02:00:00Z";
  assert.equal(
    bindConferenceReports(archive, started, now)[0].eventBindingVerified,
    false,
  );
});

test("single-digit official publication hours retain exact timezone and invalid-clock guards", () => {
  const r={publishDate:"2026-10-24",postedTime:"9:00:00",conferenceTimeZone:"CT"};
  assert.equal(publicationTime(r),"2026-10-24T14:00:00.000Z");
  assert.equal(publicationTime({...r,postedTime:"09:00:00"}),publicationTime(r));
  for(const postedTime of ["24:00:00","9:60:00","9:00","90000","9:00:60"])
    assert.throws(()=>publicationTime({...r,postedTime}),/invalid_publication/);
});
