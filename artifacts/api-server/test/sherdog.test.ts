import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSherdogProfile, parseSherdogSearch } from "../src/lib/sherdog.ts";

const SEARCH_HTML = `
<table>
<tr onclick="document.location='/fighter/Aaron-Aby-12345';">
  <td><a href="/fighter/Aaron-Aby-12345">Aaron Aby</a></td>
</tr>
<tr onclick="document.location='/fighter/Other-Fighter-99999';">
  <td><a href="/fighter/Other-Fighter-99999">Other Fighter</a></td>
</tr>
</table>
`;

const PROFILE_HTML = `
<span class="fn">Kamil Milic</span>
<span class="record">6-2-0</span>
<strong itemprop="nationality">Sweden</strong>
<div class="bio-holder">
<table>
<tr><td>HEIGHT</td><td><b>5'6"</b></td></tr>
<tr><td>REACH</td><td><b>68"</b></td></tr>
<tr><td>STANCE</td><td><b>Orthodox</b></td></tr>
<tr><td>AGE</td><td><b>28</b></td></tr>
</table>
</div>
<div class="winsloses-holder">
<div class="wins">KO <em>/</em> TKO</div>
<div class="meter"><div class="pl">3</div></div>
<div>SUBMISSIONS</div>
<div class="meter"><div class="pl">1</div></div>
<div>DECISIONS</div>
<div class="meter"><div class="pl">2</div></div>
</div>
CLASS<br /><a href="/stats/constraints/filter/weight_classes/2/Flyweight">Flyweight</a>
<table>
<tr>
  <td><span class="final_result win">win</span></td>
  <td><a href="/fighter/opponent-1">Opponent One</a></td>
  <td><span class="sub_line">Jan 12, 2025</span></td>
  <td class="winby"><b>TKO (Punches)</b></td>
</tr>
<tr>
  <td><span class="final_result loss">loss</span></td>
  <td><a href="/fighter/opponent-2">Opponent Two</a></td>
  <td><span class="sub_line">Oct 3, 2024</span></td>
  <td class="winby"><b>Decision (Unanimous)</b></td>
</tr>
</table>
`;

describe("parseSherdogSearch", () => {
  it("finds exact name match", () => {
    const hit = parseSherdogSearch(SEARCH_HTML, "Aaron Aby");
    assert.ok(hit);
    assert.equal(hit!.name, "Aaron Aby");
    assert.match(hit!.slug, /Aaron-Aby/);
  });

  it("returns null when no match", () => {
    assert.equal(parseSherdogSearch(SEARCH_HTML, "Nobody Here"), null);
  });

  it("matches same surname when first name differs in odds feed", () => {
    const html = `
    <tr onclick="document.location='/fighter/Zoran-Milic-281187';">
      <td><a href="/fighter/Zoran-Milic-281187">Zoran Milic</a></td>
    </tr>`;
    const hit = parseSherdogSearch(html, "Kamil Milic");
    assert.ok(hit);
    assert.equal(hit!.name, "Zoran Milic");
  });
});

describe("parseSherdogProfile", () => {
  it("parses record, bio, methods, and recent form", () => {
    const p = parseSherdogProfile(PROFILE_HTML, "/fighter/Kamil-Milic-54321");
    assert.ok(p);
    assert.equal(p!.resolvedName, "Kamil Milic");
    assert.deepEqual(p!.record, { wins: 6, losses: 2, draws: 0, winPct: 75 });
    assert.equal(p!.profile.displayHeight, `5'6"`);
    assert.equal(p!.profile.heightIn, 66);
    assert.equal(p!.profile.displayReach, `68"`);
    assert.equal(p!.profile.reachIn, 68);
    assert.equal(p!.profile.stance, "Orthodox");
    assert.equal(p!.profile.age, 28);
    assert.equal(p!.profile.citizenship, "Sweden");
    assert.equal(p!.weightClass, "Flyweight");
    assert.equal(p!.methods.koWins, 3);
    assert.equal(p!.methods.subWins, 1);
    assert.equal(p!.methods.decisionWins, 2);
    assert.equal(p!.recentForm.length, 2);
    assert.equal(p!.recentForm[0]!.result, "W");
    assert.equal(p!.recentForm[0]!.opponent, "Opponent One");
    assert.equal(p!.recentForm[1]!.result, "L");
  });
});
