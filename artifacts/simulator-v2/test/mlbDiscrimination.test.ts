import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  binaryAuc,
  brierResolution,
  discriminationProxy,
  meanAbsDevFromHalf,
  separationByOutcome,
  shrinkTo50Flag,
} from "../eval/familyCalibration.js";
import { baseballProfileLevers } from "../src/models/baseball/jointBaseball.js";

describe("MLB discrimination metrics", () => {
  it("meanAbsDevFromHalf collapses for coin-flip probs", () => {
    const sharp = [
      { y: 1 as const, p: 0.9 },
      { y: 0 as const, p: 0.1 },
    ];
    const coin = [
      { y: 1 as const, p: 0.5 },
      { y: 0 as const, p: 0.5 },
    ];
    assert.ok(meanAbsDevFromHalf(sharp) > 0.35);
    assert.equal(meanAbsDevFromHalf(coin), 0);
  });

  it("separation and AUC rank wins above losses", () => {
    const rows = [
      { y: 1 as const, p: 0.7 },
      { y: 1 as const, p: 0.6 },
      { y: 0 as const, p: 0.4 },
      { y: 0 as const, p: 0.3 },
      { y: 1 as const, p: 0.65 },
      { y: 0 as const, p: 0.35 },
      { y: 1 as const, p: 0.8 },
      { y: 0 as const, p: 0.2 },
      { y: 1 as const, p: 0.55 },
      { y: 0 as const, p: 0.45 },
    ];
    const sep = separationByOutcome(rows);
    assert.ok(sep.separation != null && sep.separation > 0.2);
    const auc = binaryAuc(rows);
    assert.ok(auc != null && auc > 0.9);
    const disc = discriminationProxy(rows);
    assert.equal(disc.kind, "auc");
    assert.ok((disc.value ?? 0) > 0.9);
  });

  it("shrinkTo50Flag trips on ECE↓ with mad½ collapse", () => {
    const flagged = shrinkTo50Flag({
      eceBefore: 0.12,
      eceAfter: 0.05,
      madBefore: 0.1,
      madAfter: 0.06,
    });
    assert.equal(flagged.flagged, true);
    assert.match(flagged.note, /SHRINK_TO_50/);

    const ok = shrinkTo50Flag({
      eceBefore: 0.08,
      eceAfter: 0.05,
      madBefore: 0.2,
      madAfter: 0.19,
    });
    assert.equal(ok.flagged, false);
  });

  it("brierResolution is higher when outcomes separate by bin", () => {
    const flat = Array.from({ length: 40 }, (_, i) => ({
      y: (i % 2 === 0 ? 1 : 0) as 0 | 1,
      p: 0.5,
    }));
    const separated = [
      ...Array.from({ length: 20 }, () => ({ y: 1 as const, p: 0.8 })),
      ...Array.from({ length: 20 }, () => ({ y: 0 as const, p: 0.2 })),
    ];
    const rFlat = brierResolution(flat);
    const rSep = brierResolution(separated);
    assert.ok(rFlat != null && rSep != null);
    assert.ok(rSep > rFlat);
  });

  it("default baseball profile is v0.3.1 until F.5 promotes v0.3.2", () => {
    const d = baseballProfileLevers();
    assert.equal(d.profile, "v0.3.1");
    assert.equal(d.modelVersion, "0.3.1");
    assert.equal(d.shrinkWeight, 0.2);
    assert.equal(d.gameShockSigma, 0.22);
    assert.equal(d.homeEdge, 0.07);
    assert.equal(d.strengthPreserve, 0);
    const v03 = baseballProfileLevers("v0.3");
    assert.equal(v03.shrinkWeight, 0.4);
    assert.ok(d.shrinkWeight < v03.shrinkWeight);
    assert.ok(d.gameShockSigma > v03.gameShockSigma);
    const v02 = baseballProfileLevers("v0.2");
    assert.equal(v02.shrinkWeight, 0);
    assert.equal(v02.gameShockSigma, 0);
    const v032 = baseballProfileLevers("v0.3.2");
    assert.equal(v032.profile, "v0.3.2");
    assert.equal(v032.shrinkWeight, 0.1);
    assert.ok(v032.strengthPreserve > 0);
    assert.ok(v032.formResidualWeight > 0);
    assert.ok(v032.shrinkWeight < d.shrinkWeight);
  });
});
