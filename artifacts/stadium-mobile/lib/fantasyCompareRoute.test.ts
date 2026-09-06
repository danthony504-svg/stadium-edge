import { fantasyCompareRoute } from "./fantasyCompareRoute";

test("Compare always opens Start/Sit with the tapped player", () => {
  expect(fantasyCompareRoute("allen")).toEqual({ pathname: "/fantasy-start-sit", params: { playerAId: "allen" } });
  expect(fantasyCompareRoute("mahomes").params.playerAId).toBe("mahomes");
  expect(fantasyCompareRoute("allen").pathname).not.toBe("/coach");
});
