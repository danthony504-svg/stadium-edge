import { NAV_DESTINATIONS } from "./navigationDestinations";

test("Fantasy Football navigation retains its visible BETA badge", () => {
  expect(NAV_DESTINATIONS.find((destination) => destination.route === "/fantasy")).toMatchObject({
    label: "Fantasy Football",
    beta: true,
  });
});
