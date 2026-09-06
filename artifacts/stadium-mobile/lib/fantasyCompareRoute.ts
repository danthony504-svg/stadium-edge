export function fantasyCompareRoute(playerAId: string) {
  return { pathname: "/fantasy-start-sit" as const, params: { playerAId } };
}
