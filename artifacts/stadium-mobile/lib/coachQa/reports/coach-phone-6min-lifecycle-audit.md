# Phone ~6-minute wait — client lifecycle audit (code inspection)

Backend reproduction for plain `5 leg` is **28–42s**. The production iPhone observation was ~**6 minutes** (1:43→1:49). This note separates where that gap can form.

## Lifecycle map (Coach send path)

From `app/(tabs)/coach.tsx` `send()` for a parlay build:

| Step | Where | Notes |
|---|---|---|
| 1. User tap / send | UI | `setBusy(true)`, `building: true`, status "Starting board scan…" |
| 2. Abort prior + new AbortController | client | Previous open session aborted |
| 3. `buildCoachParlay(...)` starts | client JS | Includes `loadScanInputs` then `tryReachFullBoardScan` |
| 4. HTTP fan-out to `API_BASE` | network | ~160 GETs/POSTs on full-board (pre–Phase 2) |
| 5. Server process + respond | Render | Server already TTL-caches many ESPN upstreams |
| 6. Client receives bodies | network + JS | `getJson` / `expoFetch` |
| 7. Sync scoring / staging | JS thread | ~1,980 game legs scored; can starve timers on device |
| 8. `onStatus` / `onPartialPicks` | React state | Status card updates; cards buffered until terminal |
| 9. `finishSession` | React state | `building: false`, unlock composer |
| 10. Ticket render | UI | Pick cards paint |

Absolute terminal arms at `onReadyToScan` (`coachAbsoluteBudgetMs(5)=75s`) and load failsafe is 90s — **neither explains a 6-minute wait by themselves** unless JS timers were delayed by long sync work / backgrounding.

## Where the phone delay most likely sits

| Hypothesis | Likelihood | Evidence |
|---|---|---|
| Server alone took ~6 min | Low | Node prod-equivalent wall 28–42s on same API/board |
| Network RTT × 160 calls on cellular | High | Same call graph; cellular + TLS amplifies; duplicate paths (146/160) |
| JS-thread starvation during GL scoring | High | Large sync scoring between awaits; setTimeout absolute terminal may fire late |
| Background / AppState throttle | Medium | iOS can defer timers/network when app not foreground; screenshot showed active UI but wall clock still accumulates |
| Duplicate overlapping Coach requests | Medium | Rapid re-sends / stop+retry; prior abort vs new send races |
| Stale session waiting on hung `res.json()` | Medium | Game/prop sim timed headers but untimed body parse historically |
| React state update / render lag after response | Low–medium | Would add seconds, not minutes, once `finishSession` runs |
| Request never left device for long | Low for whole 6 min | Status showed "Scoring game lines… (3180 posted)" ⇒ scan had started server work |

## Ordered conclusion

The phone delay is **not explained by backend processing alone**.

Most consistent split:

1. **Before/during server work on device:** cellular serialization of a large full-board fan-out + device-side sync scoring while UI remains on `awaitingPropSlots` ("Scoring game lines… props/alts next").
2. **Server processing:** only ~0.5–1 min of the wall (Node proof).
3. **After server return → render:** unlikely to own most of the 6 minutes if `finishSession` ran; user saw a completed ticket eventually, so the long stretch was mid-scan, not stuck post-response.

Phase 2 client context cache/coalesce attacks (1) by cutting duplicate context/history/ID/game-sim HTTP without changing selection quality. Separate mobile instrumentation (request start / first byte / finishSession / AppState) is still needed to timestamp a future phone capture.

## Recommended phone instrumentation (future, not in this patch)

Log once per sendGen:

- `t0` send
- `t_readyToScan`
- `t_firstPartial` / last `awaitingPropSlots` status
- `t_buildReturn`
- `t_finishSession`
- AppState changes during open session
- count of concurrent `buildCoachParlay` invocations
