# Coach regression baseline repair — October 23, 2026

The broad mobile suite had 49 failures on unchanged main. Its common PickCard
stub returned existing picks unchanged for backfill and simplified market-family
parsing. Several tests therefore did not exercise the production algorithm they
claimed to verify.

## Runtime changes

Move existing pure parsing, quote resolution, alt-ladder and backfill functions
and their types into pickCardModel.ts. PickCard preserves its public exports and
native rendering; tests now re-export the production model rather than no-op
selection functions. Preserve Android layout-animation initialization in the UI.
No native dependency or additional fetch/simulation is introduced.

Testing the real code exposed two candidate-preparation faults:

1. The documented one-step deep-pool relaxation passed raised caps into the
   bucket walker but tryAdd still checked the original captured caps, discarding
   otherwise eligible raw candidates. Pass the active caps through. This is
   candidate preparation only; final quality and correlation checks still apply.
2. Deep fill could early-return an already-full game-line scaffold or keep an
   oversized existing scaffold. Enforce the documented three-game-line generic /
   two-game-line longshot budgets before any early return and top-up.

## Test corrections

- Explicit synthetic exact-market provenance for fixtures that intend qualified
  props; distinct synthetic athlete/event ids for distinct participants/games.
  These are unit-test evidence fixtures, not records of real provider/model runs.
- Current basketball model identity on a simulated game-line fixture.
- Raw confidence/grade/EV floors remain unchanged; history-only unvalidated HR
  probabilities remain unavailable. The rare-count math is tested separately.
- Current cancellation classification, weighted-score rounding, per-market and
  per-game caps, and soft (not hard) market-shape variety semantics.
- Local-calendar fixture times are constructed in local time rather than mixing
  fixed UTC kickoff dates with an arbitrary machine timezone.
- Native rendering remains stubbed in Node. Its automated bundle export does not
  certify a physical-device cold launch. The live terminal harness is explicitly
  skipped in the offline suite; no synthetic result is called a production pass.

The independent NCAAF model holdout and the phone OTA/device test are still
separate requirements. No NCAAF game-line unlock or native build is included.

This supersedes the unresolved mobile-test-debt snapshots in the PR895/896 notes.

## Final local verification

- Full offline mobile discovery: 2,193 passed, 0 failed, 2 skipped (2,195 tests).
  One skip is the explicitly disabled live terminal harness; skipped probes are
  not production passes.
- Release-critical suite, mobile typecheck and iOS Hermes export pass.
- Backend source is unchanged from PR896 (728 API tests pass, 12 skipped).
- Phone OTA remains unpublished in this session: GitHub browser authentication
  was declined. A source merge does not update installed devices.
