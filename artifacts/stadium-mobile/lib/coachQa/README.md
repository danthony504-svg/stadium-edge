# Coach QA harness

Offline AI Coach regression / fuzz / invariant audit.

## Run

```bash
cd artifacts/stadium-mobile
node --import ./test/register-hooks.mjs --test lib/coachQa/coachQa.harness.test.ts
```

Or via package script:

```bash
pnpm test:coach-qa
```

Reports write to `lib/coachQa/reports/`:

- `coach-qa-report.md`
- `coach-qa-report.json`
- `coach-qa-results.jsonl`

## Scope

- Request matrix (legs 2–15 × sports × markets × dates × teams × wording)
- Parser invariants
- Sequential-state torture + ≥1000 seeded fuzz sequences
- Fixture pipeline / provenance / mapping checks
- Market coverage matrix
- Failure-injection parser smoke + documented live skips

Does **not** change production Coach behavior, thresholds, merge, deploy, OTA, or EAS builds.

Large fuzz is fixture/parser-only (no paid live API spam). Live provider E2E is a separate controlled subset.
