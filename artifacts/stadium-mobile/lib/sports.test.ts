import { SPORTS } from "./sports";

test("college football retains the ncaaf filter key and user label", () => {
  expect(SPORTS.find((sport) => sport.id === "ncaaf")).toMatchObject({ id: "ncaaf", label: "College Football" });
  expect(SPORTS.find((sport) => sport.id === "nfl")?.label).toBe("NFL");
});
