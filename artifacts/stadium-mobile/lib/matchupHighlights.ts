/** Compact descriptive evidence, never a probability or play-calling adjustment. */
export function matchupHighlights(observations: string[], runContext?: string | null): string[] {
  const recent = observations.find(t => t.startsWith("Exact-market history:"));
  const position = observations.find(t => t.includes("allowed at least one opposing"));
  const defense = observations.find(t => t.includes("opposing team production allowed") || t.includes("Broader passing context") || / allows .*\/game/.test(t));
  const opportunity = observations.find(t => /^(Playing time:|Pass attempts:|Carries:|Targets:)/.test(t));
  const shorten = (t: string) => {
    const sample = t.match(/based on (\d+) (?:completed )?games/);
    const main = t.split(" (")[0]!;
    return main + (sample ? ` (based on ${sample[1]} games).` : " (sample details in Read more).") + " Team-wide context, not an individual forecast.";
  };
  return [
    recent?.replace("Exact-market history:", "Recent form:").replace(/ \(last .*$/, "."),
    defense ? shorten(defense) : "Opponent's exact-market defensive history is unavailable.",
    position?.replace(/ with complete verified.*$/, ". Each game counts once; not a player hit rate."),
    runContext ? "Run-defense context: " + shorten(runContext) : opportunity?.replace(/ Future minutes.*$/, ""),
  ].filter((t): t is string => !!t);
}
