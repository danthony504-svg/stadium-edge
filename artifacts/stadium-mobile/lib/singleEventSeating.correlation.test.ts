/**
 * Before/after proof: Pass TD + receivers + Seahawks spread soft correlation
 * must change seatSingleEventTicket selection. Caps are not correlation.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { seatSingleEventTicket, SINGLE_EVENT_CAPS } from "./singleEventSeating.ts";
import {
  parlayCorrelationPenalty,
  isPassTdPropMarket,
  isReceivingPropMarket,
} from "./parlayCorrelationScore.ts";
import { parlayAmerican, parlayImplied, impliedProb } from "./format.ts";
import type { SeatPick } from "./singleEventSeating.ts";

const GAME = "Seattle Seahawks @ Denver Broncos";
const SPORT = "nfl";

function leg(
  partial: SeatPick & { rankScore: number },
): { pick: SeatPick; rankScore: number } {
  const { rankScore, ...pick } = partial;
  return { pick: { sport: SPORT, ...pick }, rankScore };
}

/** SEA@DEN pool shaped like the live 7-leg + alternatives. */
function seaDenPool() {
  return [
    leg({
      game: GAME,
      market: "Spread",
      pick: "Seahawks +1.5",
      odds: -110,
      isProp: false,
      rankScore: 100,
    }),
    leg({
      game: GAME,
      market: "Rec Yds",
      pick: "Jaxon Smith-Njigba Over 92.5 Rec Yds",
      odds: -115,
      isProp: true,
      player: "Jaxon Smith-Njigba",
      rankScore: 95,
    }),
    leg({
      game: GAME,
      market: "Receptions",
      pick: "Tory Horton Over 0.5 Receptions",
      odds: -130,
      isProp: true,
      player: "Tory Horton",
      rankScore: 90,
    }),
    leg({
      game: GAME,
      market: "Rush Yds",
      pick: "George Holani Over 13.5 Rush Yds",
      odds: -110,
      isProp: true,
      player: "George Holani",
      rankScore: 85,
    }),
    // High raw rank so Pass TDs seats before the Shaheed vs Sacks decision;
    // soft Pass-TD↔receiver bump then demotes Shaheed (not a hard reject).
    leg({
      game: GAME,
      market: "Pass TDs",
      pick: "Sam Darnold Over 1.5 Pass TDs",
      odds: +120,
      isProp: true,
      player: "Sam Darnold",
      rankScore: 200,
    }),
    // Receiver anytime-TD — raw rank beats Sacks; Pass-TD↔receiver bump demotes it.
    leg({
      game: GAME,
      market: "Anytime TD",
      pick: "Rashid Shaheed Anytime TD",
      odds: +150,
      isProp: true,
      player: "Rashid Shaheed",
      rankScore: 78,
    }),
    leg({
      game: GAME,
      market: "Sacks",
      pick: "Nik Bonitto Over 0.5 Sacks",
      odds: -105,
      isProp: true,
      player: "Nik Bonitto",
      rankScore: 76,
    }),
    leg({
      game: GAME,
      market: "Receptions",
      pick: "Emanuel Wilson Under 1.5 Receptions",
      odds: -120,
      isProp: true,
      player: "Emanuel Wilson",
      rankScore: 70,
    }),
    leg({
      game: GAME,
      market: "Total",
      pick: "Over 45.5",
      odds: -110,
      isProp: false,
      rankScore: 68,
    }),
  ];
}

function asCorr(p: SeatPick) {
  return {
    game: p.game,
    market: p.market,
    pick: p.pick,
    odds: p.odds,
    isProp: !!p.isProp,
    player: p.player ?? undefined,
    sport: p.sport ?? SPORT,
  };
}

/**
 * Constrained last prop seat: correlation must change **membership**, not only order.
 * maxProps leaves one prop slot after Seahawks + Darnold + two receivers.
 */
test("constrained-slot: Pass-TD↔receiver soft-corr changes final ticket membership", () => {
  const ranked = seaDenPool();
  const seahawks = ranked.find((r) => /Seahawks \+1\.5/.test(r.pick.pick))!.pick;
  const darnold = ranked.find((r) => /Sam Darnold/.test(r.pick.pick))!.pick;
  const jsn = ranked.find((r) => /Jaxon Smith-Njigba/.test(r.pick.pick))!.pick;
  const horton = ranked.find((r) => /Tory Horton/.test(r.pick.pick))!.pick;
  const shaheed = ranked.find((r) => /Shaheed/.test(r.pick.pick))!.pick;
  const sacks = ranked.find((r) => /Bonitto/.test(r.pick.pick))!.pick;
  const total = ranked.find((r) => /Over 45\.5/.test(r.pick.pick))!;

  // Existing: 1 GL + 3 props. target 5 → CAPS[5].maxProps=4 → one prop seat left.
  // Pool omits Holani so Shaheed (78) vs Sacks (76) are the only remaining props.
  const existing = [seahawks, darnold, jsn, horton];
  assert.equal(SINGLE_EVENT_CAPS[5].maxProps, 4);
  const pool = [
    ...ranked.filter((r) => existing.some((e) => e.pick === r.pick.pick)),
    ranked.find((r) => /Shaheed/.test(r.pick.pick))!,
    ranked.find((r) => /Bonitto/.test(r.pick.pick))!,
    total,
  ];

  const before = seatSingleEventTicket(pool, {
    target: 5,
    eventKey: GAME,
    sport: SPORT,
    existing,
    correlationAware: false,
  });
  const after = seatSingleEventTicket(pool, {
    target: 5,
    eventKey: GAME,
    sport: SPORT,
    existing,
    correlationAware: true,
  });

  const beforeSet = new Set(before.picks.map((p) => p.pick));
  const afterSet = new Set(after.picks.map((p) => p.pick));

  assert.equal(before.picks.length, 5);
  assert.equal(after.picks.length, 5);
  assert.ok(beforeSet.has(shaheed.pick), `before membership includes Shaheed; got ${[...beforeSet].join(" | ")}`);
  assert.ok(!beforeSet.has(sacks.pick), `before membership excludes Sacks; got ${[...beforeSet].join(" | ")}`);
  assert.ok(afterSet.has(sacks.pick), `after membership includes Sacks; got ${[...afterSet].join(" | ")}`);
  assert.ok(!afterSet.has(shaheed.pick), `after membership excludes Shaheed; got ${[...afterSet].join(" | ")}`);

  const core = existing.map(asCorr);
  const shaheedPen = parlayCorrelationPenalty(asCorr(shaheed), core);
  const sacksPen = parlayCorrelationPenalty(asCorr(sacks), core);
  const shaheedEff = 78 - shaheedPen;
  const sacksEff = 76 - sacksPen;

  assert.ok(shaheedPen > sacksPen);
  assert.ok(shaheedPen - sacksPen >= 12, "Pass-TD↔receiver bump must drive the demotion");
  assert.ok(sacksEff > shaheedEff, `effective score Sacks ${sacksEff} > Shaheed ${shaheedEff}`);

  // Both were qualified — soft demotion, not hard reject / cap / ladder.
  const demotion = {
    contestedSlot: "last prop seat under SINGLE_EVENT_CAPS[5].maxProps=4",
    qualifiedCandidates: [
      {
        pick: shaheed.pick,
        market: shaheed.market,
        rawRank: 78,
        softPenalty: shaheedPen,
        effectiveScore: shaheedEff,
        hardReject: false,
        reason:
          "Pass-TD↔receiver bump vs Darnold (+12) + same-game props (+5 each) + Seahawks GL (+7)",
      },
      {
        pick: sacks.pick,
        market: sacks.market,
        rawRank: 76,
        softPenalty: sacksPen,
        effectiveScore: sacksEff,
        hardReject: false,
        reason: "same-game props (+5 each) + Seahawks GL (+7); no Pass-TD↔receiver bump",
      },
    ],
    beforeMembership: [...beforeSet],
    afterMembership: [...afterSet],
    selectedAfter: sacks.pick,
    demotedAfter: shaheed.pick,
    demotionKind: "soft_correlation_ranking",
    notCorrelation: ["SINGLE_EVENT_CAPS maxProps", "ladder/participant hard gates"],
  };

  const outDirs = [
    "/workspace/artifacts/api-server/test/fixtures",
    "/opt/cursor/artifacts",
  ];
  for (const dir of outDirs) {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        `${dir}/sea-den-constrained-slot-membership.json`,
        `${JSON.stringify(
          {
            tipSha: "376eceab8d15f893bd1a280da36154a265c3fd2e",
            verificationAt: "376eceab8d15f893bd1a280da36154a265c3fd2e",
            ...demotion,
            pass: true,
          },
          null,
          2,
        )}\n`,
      );
    } catch {
      /* optional */
    }
  }
});

test("Pass TD + receivers + Seahawks spread soft-corr changes seven-leg seating", () => {
  assert.equal(isPassTdPropMarket("Pass TDs"), true);
  assert.equal(isReceivingPropMarket("Anytime TD"), true);
  assert.equal(isReceivingPropMarket("Rec Yds"), true);

  const ranked = seaDenPool();
  const seahawks = ranked[0]!.pick;

  // Seed Seahawks spread so Pass-TD↔receiver↔spread stack is on the ticket
  // while filling remaining seats (mirrors single-event GL already chosen).
  // target 8 → SINGLE_EVENT_CAPS[8] maxProps=6 so Shaheed vs Sacks compete on
  // soft correlation, not the prop count ceiling.
  const before = seatSingleEventTicket(ranked, {
    target: 8,
    eventKey: GAME,
    sport: SPORT,
    existing: [seahawks],
    correlationAware: false,
  });
  const after = seatSingleEventTicket(ranked, {
    target: 8,
    eventKey: GAME,
    sport: SPORT,
    existing: [seahawks],
    correlationAware: true,
  });

  const beforePicks = before.picks.map((p) => p.pick);
  const afterPicks = after.picks.map((p) => p.pick);

  // Seven-leg proof window: first 7 seats (existing Seahawks + 6 fills).
  assert.ok(before.picks.length >= 7);
  assert.ok(after.picks.length >= 7);
  const before7 = beforePicks.slice(0, 7);
  const after7 = afterPicks.slice(0, 7);
  assert.ok(before7[0] && /Seahawks \+1\.5/.test(before7[0]));
  assert.ok(after7[0] && /Seahawks \+1\.5/.test(after7[0]));
  assert.ok(before7.some((p) => /Sam Darnold/.test(p)));
  assert.ok(after7.some((p) => /Sam Darnold/.test(p)));
  assert.ok(
    before7.some((p) => /Rashid Shaheed/.test(p)),
    `before keeps Shaheed Anytime TD on raw rank; got ${before7.join(" | ")}`,
  );
  const beforeShaheedIdx = before7.findIndex((p) => /Rashid Shaheed/.test(p));
  const beforeSacksIdx = before7.findIndex((p) => /Nik Bonitto/.test(p));
  const afterShaheedIdx = after7.findIndex((p) => /Rashid Shaheed/.test(p));
  const afterSacksIdx = after7.findIndex((p) => /Nik Bonitto/.test(p));
  assert.ok(beforeShaheedIdx >= 0, "before includes Shaheed");
  assert.ok(
    beforeSacksIdx < 0 || beforeShaheedIdx < beforeSacksIdx,
    `before: Shaheed seats before Sacks on raw rank; got ${before7.join(" | ")}`,
  );
  assert.ok(afterSacksIdx >= 0, `after must seat Sacks; got ${after7.join(" | ")}`);
  assert.ok(
    afterShaheedIdx < 0 || afterSacksIdx < afterShaheedIdx,
    `after: Sacks seats before Shaheed under Pass-TD↔receiver soft bump; got ${after7.join(" | ")}`,
  );
  assert.notDeepEqual(before7, after7);

  // Soft penalties that drove the order swap (not hard rejects).
  const ticketCore = before.picks
    .slice(0, 7)
    .filter((p) => /Seahawks|Jaxon|Horton|Holani|Darnold/.test(p.pick))
    .map(asCorr);
  const shaheed = ranked.find((r) => /Shaheed/.test(r.pick.pick))!.pick;
  const sacks = ranked.find((r) => /Bonitto/.test(r.pick.pick))!.pick;
  const shaheedPen = parlayCorrelationPenalty(asCorr(shaheed), ticketCore);
  const sacksPen = parlayCorrelationPenalty(asCorr(sacks), ticketCore);
  assert.ok(
    shaheedPen > sacksPen,
    `Shaheed soft penalty ${shaheedPen} must exceed Sacks ${sacksPen}`,
  );
  assert.ok(shaheedPen - sacksPen >= 12, "Pass-TD↔receiver bump (≥12) must contribute");

  // Limitation label: under CAPS[8].maxProps=6 both Shaheed and Sacks still fit
  // the seven-leg window — correlation changes **order**, not membership.
  // Membership change requires a constrained last prop seat (sibling test).
  assert.ok(before7.some((p) => /Rashid Shaheed/.test(p)));
  assert.ok(after7.some((p) => /Rashid Shaheed/.test(p)));
  assert.ok(before7.some((p) => /Nik Bonitto/.test(p)) || after7.some((p) => /Nik Bonitto/.test(p)));
  const sevenLegLimitation = {
    label: "ORDER_ONLY_NOT_MEMBERSHIP",
    meaning:
      "All seven seats remain filled by the same qualified pool members (Shaheed stays on the 7-leg window) because CAPS[8].maxProps=6 leaves room for both Shaheed and Sacks after Seahawks+Darnold+receivers. No better-qualified alternative exists outside this pool that would drop a core leg; correlation only reorders Shaheed vs Sacks. For membership change see constrained-slot test.",
    betterQualifiedAlternativesOutsidePool: false,
  };
  assert.equal(sevenLegLimitation.label, "ORDER_ONLY_NOT_MEMBERSHIP");

  // Caps hold — documented separately from correlation.
  assert.ok(after.picks.filter((p) => p.isProp).length <= SINGLE_EVENT_CAPS[8].maxProps);
  assert.ok(after.picks.filter((p) => !p.isProp).length <= SINGLE_EVENT_CAPS[8].maxGameEventLines);

  // Displayed slip combined odds / implied = independence product of book odds.
  const afterOdds = after.picks
    .slice(0, 7)
    .map((p) => p.odds)
    .filter((o): o is number => o != null);
  const combinedAmerican = parlayAmerican(afterOdds);
  const combinedImplied = parlayImplied(afterOdds);
  const productCheck = afterOdds.reduce((acc, o) => acc * impliedProb(o), 1);
  assert.ok(Math.abs(combinedImplied - productCheck) < 1e-12);
  assert.ok(combinedAmerican != null);

  const stepwise: Array<{
    pick: string;
    softPenaltyVsPrior: number;
    reason: string;
  }> = [];
  const seated: SeatPick[] = [];
  for (const p of after.picks.slice(0, 7)) {
    const pen = parlayCorrelationPenalty(asCorr(p), seated.map(asCorr));
    let reason = "raw rank / quality gates";
    if (pen === 0) reason = "first seat / no prior same-game legs";
    else if (/Bonitto/.test(p.pick)) {
      reason = `soft demotion beat Shaheed Anytime TD (Pass-TD↔receiver bump); penalty=${pen}`;
    } else if (p.isProp) {
      reason = `same-game prop soft stack penalty=${pen} (Pass-TD↔receiver +12 when applicable; else +5; vs GL +7)`;
    } else {
      reason = `game-side soft penalty=${pen}`;
    }
    stepwise.push({ pick: p.pick, softPenaltyVsPrior: pen, reason });
    seated.push(p);
  }

  const artifact = {
    tipNote: "pin after commit — filled by review pack",
    ask: "8 leg broncos (single-event seating unit proof)",
    game: GAME,
    seatingPath: "seatSingleEventTicket",
    correlationAware: true,
    hardRejects: {
      passTdPlusReceiver: false,
      passTdPlusSeahawksSpread: false,
      note: "soft ranking demotion only — valid same-game combos remain seatable",
    },
    before: {
      correlationAware: false,
      picks: before.picks.slice(0, 7).map((p, i) => ({
        i: i + 1,
        market: p.market,
        pick: p.pick,
        isProp: !!p.isProp,
        odds: p.odds ?? null,
      })),
    },
    after: {
      correlationAware: true,
      picks: after.picks.slice(0, 7).map((p, i) => ({
        i: i + 1,
        market: p.market,
        pick: p.pick,
        isProp: !!p.isProp,
        odds: p.odds ?? null,
      })),
      stepwiseSoftPenalties: stepwise,
    },
    influence: {
      demotedRelative: "Rashid Shaheed Anytime TD seats after Nik Bonitto (was before on raw rank)",
      seatedEarlier: "Nik Bonitto Over 0.5 Sacks",
      beforeOrder: before7,
      afterOrder: after7,
      shaheedPenaltyVsCore: shaheedPen,
      sacksPenaltyVsCore: sacksPen,
      passTdReceiverBumpApplied: true,
      hardReject: false,
      capsAreNotCorrelation: true,
      sevenLegLimitation: {
        label: "ORDER_ONLY_NOT_MEMBERSHIP",
        meaning:
          "All seven remain because SINGLE_EVENT_CAPS[8].maxProps=6 still fits both Shaheed and Sacks; no better-qualified alternatives exist outside this pool. Correlation reorders only. Membership change is proven in sea-den-constrained-slot-membership.json.",
      },
    },
    displayedTicketMath: {
      combinedAmericanOdds: combinedAmerican,
      parlayImpliedFromOddsProduct: combinedImplied,
      dependenceAdjusted: false,
      meaning:
        "parlayAmerican / parlayImplied multiply per-leg book prices under independence — not a joint Pass-TD↔receiver model probability. Per-leg Coach confidencePct/edgePct stay per-leg.",
    },
    pass: true,
  };

  const outDirs = [
    "/workspace/artifacts/api-server/test/fixtures",
    "/opt/cursor/artifacts",
  ];
  for (const dir of outDirs) {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        `${dir}/sea-den-7leg-correlation-before-after.json`,
        `${JSON.stringify(artifact, null, 2)}\n`,
      );
    } catch {
      /* optional mirror */
    }
  }
});
