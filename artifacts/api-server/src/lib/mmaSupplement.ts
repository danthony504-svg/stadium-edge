// Supplemental MMA fighter data — Tapology (when reachable) then Sherdog.

import type { Fighter, FighterDataSource, FighterRecentFight } from "./ufc.js";

function mapSherdogToFighter(name: string, s: Awaited<ReturnType<typeof import("./sherdog.js").fetchSherdogProfile>>): Fighter | null {
  if (!s) return null;
  const recentForm: FighterRecentFight[] = s.recentForm.map((r) => ({
    result: r.result,
    opponent: r.opponent,
    date: r.date,
    method: r.method,
  }));
  const f: Fighter = {
    name,
    resolvedName: s.resolvedName,
    athleteId: null,
    weightClass: s.weightClass,
    record: s.record,
    profile: {
      age: s.profile.age,
      heightIn: s.profile.heightIn,
      displayHeight: s.profile.displayHeight,
      reachIn: s.profile.reachIn,
      displayReach: s.profile.displayReach,
      stance: s.profile.stance,
      citizenship: s.profile.citizenship,
    },
    stats: {
      strikeAccuracy: null,
      strikeLPM: null,
      takedownAccuracy: null,
      takedownAvg: null,
      submissionAvg: null,
      finishPct:
        s.record && s.record.wins > 0 && s.methods.koWins != null
          ? Math.round((((s.methods.koWins ?? 0) + (s.methods.tkoWins ?? 0)) / s.record.wins) * 1000) / 10
          : null,
      decisionPct:
        s.record && s.record.wins > 0 && s.methods.decisionWins != null
          ? Math.round((s.methods.decisionWins / s.record.wins) * 1000) / 10
          : null,
    },
    methods: {
      koWins: s.methods.koWins,
      tkoWins: s.methods.tkoWins,
      subWins: s.methods.subWins,
      decisionWins: s.methods.decisionWins,
      koLosses: null,
      tkoLosses: null,
      subLosses: null,
    },
    style: null,
    dataSources: ["sherdog"],
    recentForm,
  };
  return f;
}

export function mergeFighters(base: Fighter, patch: Fighter): Fighter {
  const sources = [...new Set<FighterDataSource>([...base.dataSources, ...patch.dataSources])];
  const merged: Fighter = {
    name: base.name || patch.name,
    resolvedName: base.resolvedName || patch.resolvedName,
    athleteId: base.athleteId || patch.athleteId,
    weightClass: base.weightClass || patch.weightClass,
    record: base.record || patch.record,
    profile: {
      age: base.profile.age ?? patch.profile.age,
      heightIn: base.profile.heightIn ?? patch.profile.heightIn,
      displayHeight: base.profile.displayHeight ?? patch.profile.displayHeight,
      reachIn:
        base.profile.reachIn != null && base.profile.reachIn > 0
          ? base.profile.reachIn
          : patch.profile.reachIn,
      displayReach:
        base.profile.displayReach && base.profile.displayReach !== '0"'
          ? base.profile.displayReach
          : patch.profile.displayReach,
      stance: base.profile.stance ?? patch.profile.stance,
      citizenship: base.profile.citizenship ?? patch.profile.citizenship,
    },
    stats: {
      strikeAccuracy: base.stats.strikeAccuracy ?? patch.stats.strikeAccuracy,
      strikeLPM: base.stats.strikeLPM ?? patch.stats.strikeLPM,
      takedownAccuracy: base.stats.takedownAccuracy ?? patch.stats.takedownAccuracy,
      takedownAvg: base.stats.takedownAvg ?? patch.stats.takedownAvg,
      submissionAvg: base.stats.submissionAvg ?? patch.stats.submissionAvg,
      finishPct: base.stats.finishPct ?? patch.stats.finishPct,
      decisionPct: base.stats.decisionPct ?? patch.stats.decisionPct,
    },
    methods: {
      koWins: base.methods.koWins ?? patch.methods.koWins,
      tkoWins: base.methods.tkoWins ?? patch.methods.tkoWins,
      subWins: base.methods.subWins ?? patch.methods.subWins,
      decisionWins: base.methods.decisionWins ?? patch.methods.decisionWins,
      koLosses: base.methods.koLosses ?? patch.methods.koLosses,
      tkoLosses: base.methods.tkoLosses ?? patch.methods.tkoLosses,
      subLosses: base.methods.subLosses ?? patch.methods.subLosses,
    },
    style: base.style || patch.style,
    dataSources: sources,
    recentForm: base.recentForm.length ? base.recentForm : patch.recentForm,
  };
  return merged;
}

function isBogusReach(f: Fighter): boolean {
  return (
    f.profile.reachIn === 0 ||
    f.profile.displayReach === '0"' ||
    f.profile.displayReach === "0' 0\""
  );
}

export function fighterNeedsSupplement(f: Fighter): boolean {
  if (!f.record && !f.athleteId) return true;

  const missingBio =
    f.profile.age == null && !f.profile.displayHeight && !f.profile.displayReach;
  const missingMethods =
    f.methods.koWins == null &&
    f.methods.tkoWins == null &&
    f.methods.subWins == null &&
    f.methods.decisionWins == null;
  const missingStats =
    f.stats.strikeLPM == null &&
    f.stats.takedownAvg == null &&
    f.stats.strikeAccuracy == null &&
    f.stats.finishPct == null;

  // ESPN core profile can fail while records/statistics succeed — fill bio via Sherdog.
  if (missingBio) return true;
  if (isBogusReach(f)) return true;
  // Method split missing from ESPN records — Sherdog carries KO/SUB/DEC counts.
  if (missingMethods && !!f.record) return true;
  // ESPN resolved the fighter but strike/finish rates are empty — common on regional cards.
  if (!!f.athleteId && !!f.record && missingStats && f.recentForm.length === 0) return true;
  // Partial method split without recent form — Sherdog fills the rest.
  const partialMethods =
    !!f.record &&
    f.recentForm.length === 0 &&
    (f.methods.decisionWins == null || f.methods.koWins == null) &&
    (f.methods.subWins != null || f.methods.tkoWins != null);
  if (partialMethods) return true;
  // Fully unresolved regional fighter with no stats anywhere.
  if (missingStats && f.recentForm.length === 0 && !f.record) return true;

  return false;
}

/** Tapology when reachable, otherwise Sherdog. */
export async function loadSupplementalFighterProfile(
  name: string,
  opts: { opponent?: string } = {},
): Promise<Fighter | null> {
  const { fetchSherdogProfile } = await import("./sherdog.js");
  const { fetchTapologyProfile } = await import("./tapology.js");
  const tap = await fetchTapologyProfile(name);
  if (tap) {
    const sh = await fetchSherdogProfile(name, opts);
    const fighter = mapSherdogToFighter(name, sh);
    if (fighter) {
      fighter.dataSources = ["tapology", "sherdog"];
      return fighter;
    }
  }
  return mapSherdogToFighter(name, await fetchSherdogProfile(name, opts));
}
