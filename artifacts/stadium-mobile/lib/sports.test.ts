import { SPORTS } from "./sports";

test("NCAAF retains the ncaaf filter key and user label", () => {
  expect(SPORTS.find((sport) => sport.id === "ncaaf")).toMatchObject({ id: "ncaaf", label: "NCAAF" });
  expect(SPORTS.find((sport) => sport.id === "nfl")?.label).toBe("NFL");
});
