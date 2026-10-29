# Confirmed single-game Coach routing

A generic fixed-leg sport request could return one game line plus two player
props because final delivery kept multi-game diversity caps even when there was
only one game in the eligible slate. This change resolves an internal single-game
ask only when the independently loaded odds and schedule agree on the sole event
within Coach's existing 48-hour pregame window. It requires matching sport, both
teams and kickoff (within five minutes). Missing/ambiguous schedule times,
multiple eligible events, multiple sports and explicit multi-game requests retain
existing behavior. Two-leg previews retain their existing path.

The resolved scope is carried to staging, builder partial/terminal delivery and
UI stop/error/budget flushes. The user message is not rewritten. Existing
single-event seating retains its participant, duplicate-ladder, quality,
provenance and correlation checks. No provider calls, simulation work or request
budget extension are added by scope resolution. College validation locks remain
upstream and unchanged.

Verification on October 29, 2026:
- 142 relevant regression tests and 404 release-critical tests passed.
- Mobile type check passed.
- Live NFL GET responses: one odds event inside the existing window; schedule
  corroborates Panthers at Packers. Later-week schedule events are excluded
  using the same 48-hour window.
- Modified client against live API: five of eight selections, four player props,
  13.8 seconds, no timeout. Diagnostics uploads were gated off by the test runtime.
  This was a Node replay, not iPhone rendering or a mobile OTA release.
- Qualified fixture pools survive staging and terminal delivery at eight distinct
  participants across NFL, NBA, WNBA, MLB, NHL and soccer.

This resolves the identified mode/cap mismatch, not all underfill. The live
board did not produce eight deliverable selections in the replay. Missing exact-
line responses, missing market-specific opponent evidence and scan coverage
remain separate work; they must not be relabeled as quality failures or bypassed
for fulfillment. Live timing is one sample, not a guaranteed speed bound.
