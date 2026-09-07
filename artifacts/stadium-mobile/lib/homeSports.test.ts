import { homeSports, HOME_SPORT_IDS } from "./homeSports";
import { SPORTS } from "./sports";

test("Home pill map receives the required explicit sport order", () => {
  const finalRenderedIds = homeSports(SPORTS).map((sport) => sport.id);

  expect(finalRenderedIds).toEqual(HOME_SPORT_IDS);
  expect(finalRenderedIds).toEqual([
    "nfl",
    "ncaaf",
    "mlb",
    "nba",
    "wnba",
    "nhl",
    "soccer",
    "tennis",
    "ufc",
  ]);
});

test("Home order is independent of catalog and availability-filter order", () => {
  const availabilityOrderedCatalog = [
    SPORTS.find((sport) => sport.id === "ufc")!,
    SPORTS.find((sport) => sport.id === "mlb")!,
    SPORTS.find((sport) => sport.id === "ncaaf")!,
    SPORTS.find((sport) => sport.id === "nfl")!,
  ];

  expect(homeSports(availabilityOrderedCatalog).map((sport) => sport.id)).toEqual([
    "nfl",
    "ncaaf",
    "mlb",
    "ufc",
  ]);
});
