/** Descriptive full-game clearance only. Pushes are not wins for either side. */
export function historicalSides(values: readonly number[], line: number) {
 const sample=values.filter(Number.isFinite);
 return {total:sample.length,over:sample.filter(v=>v>line).length,under:sample.filter(v=>v<line).length,pushes:sample.filter(v=>v===line).length};
}
