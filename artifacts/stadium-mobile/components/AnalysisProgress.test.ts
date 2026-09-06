import { finalTicketChecklistState } from "./AnalysisProgress";

test("final ticket stage spins during composition and checks only after visible finalization", () => {
  expect(finalTicketChecklistState(false, "score")).toBe("active");
  expect(finalTicketChecklistState(false, "board-scan")).toBe("pending");
  expect(finalTicketChecklistState(false, "board-scan", true)).toBe("active");
  expect(finalTicketChecklistState(true, "score")).toBe("complete");
});
