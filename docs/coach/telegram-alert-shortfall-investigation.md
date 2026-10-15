# Investigation: why Coach shortfall produced no Telegram alert

**Scope:** Bo Nix / 3-of-10 (and similar honest shortfalls) · tip context `42a9ace9` / audit `13f8b44c`  
**No deploy / OTA** — findings only.  
**Do not** treat `/api/healthz` alone as proof that Coach alerting works.

---

## Verdict

**No Telegram page was expected.** A partial ticket with real odds and grounded picks classifies as:

| Field | Value |
|-------|--------|
| `eventType` | `parlay_underfilled` |
| `failureReason` | `legitimate_underfill` |
| Fingerprint | `coach\|parlay_underfilled\|legitimate_underfill\|fulfillment\|nfl\|parlay_build\|10\|3` |
| `shouldAlertCoachEvent` | **`false`** (digest-only by design) |

That is **legitimate shortfall**, not a pipeline failure. Monitoring rule evaluated and correctly suppressed paging.

---

## Trace: device scan → monitor → Telegram

```
buildParlay (mobile)
  coachRelRequestId = greenfield-<Date.now()>   // no scanId in this pipeline
  reportCoachScanReliability(...)
    │
    ├─ shouldSendCrashReports() false? → STOP (no POST; needs RN runtime / OTA)
    ├─ inFlight ≥ 2? → STOP
    └─ buildCoachReliabilityBody
          3/10 + grounded picks + odds →
          { eventType: parlay_underfilled, failureReason: legitimate_underfill, … }
                │
                ▼
POST /api/reliability/coach-events
                │
                ▼
recordCoachReliabilityEvent
  shouldAlertCoachEvent(meta) === false
    → row may store for digest
    → sendCoachAlertIfAllowed returns false
    → telegramEligible=false, alerted=false
    → NO Telegram send
```

Server `POST /chat` path uses the same `classifyParlayOutcome` + `classifyParlayFailureReason` → same digest-only outcome when `realOddsAvailable === true`.

There is **no `scanId`** in reliability payloads — only `requestId` (mobile) and optional `correlationId` (`crdiag-…`, logs only).

---

## Schedule / credentials / recent delivery (no secrets)

| Check | Evidence |
|-------|----------|
| Health cron scheduled | GH Actions `reliability-health-cron.yml` — last success **2026-10-15T18:44Z** |
| Digest cron scheduled | `reliability-digest-cron.yml` — last success **2026-10-15T17:35Z** |
| Telegram probe | Manual `reliability-telegram-probe.yml` **2026-10-11** → `delivery/dedupe/recovery: true` |
| Env names (server) | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `RELIABILITY_TELEGRAM_ENABLED`, `NOTIFY_CRON_KEY` |
| Digest Telegram | Response included `"telegram":{"ok":true}` — **configured and send path healthy** for digest |
| Healthz | API `status:ok`, `ai.ok`, deploymentSha `ddeb4733…` — **orthogonal** to Coach fulfillment alerts |

Cloud-agent env has Telegram secrets **absent** (expected — production holds them on Render). Cron secrets are present in Actions (workflows would fail closed otherwise).

### Latest digest Coach window (24h ending ~17:36Z)

| Metric | Value |
|--------|------:|
| totalRequests | 2 |
| legitimateUnderfillCount | **0** |
| underfillCount | 0 |
| zeroResultCount | **2** |
| p50 / p95 | 17 ms / 22 ms |

Interpretation: the two ingested Coach rows were **fast zero-result** events (likely early-exit / blocked-market formpack style), **not** the multi-second 3-of-10 board shortfall. Zero-result **is** Telegram-eligible; those pages (if any) are separate from shortfall suppression. Shortfall events either:

1. Never POSTed from device (mobile gate / no OTA reporter), or  
2. Occurred **after** this digest window and would still be **digest-only** when ingested.

---

## Suppression / cooldown / dedupe

| Mechanism | Effect on this shortfall |
|-----------|--------------------------|
| `shouldAlertCoachEvent` | **Primary reason for no page** |
| 30m fingerprint quiet window (`CRASH_DEDUPE_WINDOW_MS`) | N/A once rule returns false |
| Shared PG dedupe required | N/A (no send attempted) |
| `RELIABILITY_TELEGRAM_ENABLED=0` | Not indicated — digest `telegram.ok` |
| Missing bot/chat | Not indicated — same |
| Test fixtures | Would 202 + never alert; not this path |
| Rate limit 30/10m | Would 429; no evidence for this ask |

---

## Coverage matrix (pipeline vs shortfall)

| Scenario | Event / reason | Telegram? |
|----------|----------------|-----------|
| Coach exception | `coach_exception` | **Yes** |
| Timeout / stuck / deadline overrun | `coach_timeout` / `coach_scan_freeze` (`ABSOLUTE_BUDGET`, `SCAN_THREW`, `PROP_PHASE_INCOMPLETE`) | **Yes** |
| Simulation / missing sim grade | `coach_simulation_failure` | **Yes** |
| Empty prop/alt pool | `coach_alt_market_failure` | **Yes** |
| Grounding mismatch | `coach_grounding_failure` | **Yes** |
| Odds mismatch / zero with no odds | `coach_odds_mismatch` / `odds_mismatch` | **Yes** |
| Honest shortfall (3/10, odds present, grounded) | `parlay_underfilled` + `legitimate_underfill` | **No** (digest) |
| Quality bar / scored-not-staged | same legitimate underfill | **No** |
| Full fill | `parlay_fulfilled` | **No** |
| Engine-stamp fail-closed / unsupported market | Selection reject; may become sim-failure **if** all grades empty — **no dedicated Telegram category** | Indirect only |
| Extreme model↔book disagreement (e.g. anytime TD) | Seat dampen / reject only — **diagnostic review, not auto “model error” page** | **No** |
| Unmapped `P0_UNVALIDATED_MARKETS` | `buildCoachReliabilityBody` → `null` | **No POST** (coverage gap) |

---

## Extreme disagreement flag (diagnostic)

Props such as Bo Nix Under 13.5 at −108 with displayed 98% hit are **extreme model/book disagreement**. They must **not** auto-page as proven model errors. Current system: no Telegram category for that; keep as audit/digest diagnostic (see `docs/coach/bo-nix-under-13.5-rush-audit.md`).

---

## Answers to the ask

| Question | Answer |
|----------|--------|
| Did this shortfall reach monitoring? | **If** mobile POSTed: would store as digest-only underfill. Digest at 17:36Z shows **0** legitimate underfills — **this board shortfall is not evidenced in that window**. Fast zero_results (2) did reach monitoring. |
| Which rule? | `shouldAlertCoachEvent` in `coachReliabilitySanitize.ts` |
| Why no alert? | **Legitimate underfill is digest-only** (by design). Not cron failure, not missing Telegram credentials (digest send OK), not healthz. |
| Monitor scheduled? | Yes — health ~90m, digest daily 13:00 UTC |
| Telegram configured? | Yes (digest + Oct 11 probe proved delivery) — secrets not printed |
| Pipeline failure? | **No** for 3-of-10 with odds + grounded picks |

**No deploy / OTA.**
