---
name: "AI service temporarily unavailable" on published app = stale api-server deploy
description: Debugging path when the installed/published mobile app's AI Coach shows "AI service is temporarily unavailable" but dev chat works fine.
---

# "AI service is temporarily unavailable" on the published app

The mobile coach's `_AI service is temporarily unavailable. Please try again._`
bubble is the api-server chat.ts CATCH fallback — it fires whenever the upstream
model stream THROWS (chat.ts ~line 2079). It is NOT the "AI integration not
configured" 502 (that's a different string).

**The trap:** the installed / TestFlight / published mobile app hits the DEPLOYED
api-server (EXPO_PUBLIC_DOMAIN = published host), NOT the dev workflow. So if dev
chat works but the phone says "temporarily unavailable", suspect a STALE
DEPLOYMENT first — the dev source can be many commits ahead of production.

**How to confirm:** `fetch_deployment_logs` with message filter like
`Chat stream failed|reasoning_effort|unsupported_value|400`. A real incident:
production threw `400 Unsupported value: 'reasoning_effort' does not support
'minimal' with this model` on EVERY chat, while dev source already had
`reasoning_effort: "low"`. The prod error stack pointed at an OLD line number
(chat.ts:1848) vs the current source (~2029) — a tell that prod is stale.

**Why:** the model proxy dropped support for `reasoning_effort: "minimal"`
(supported ladder is now none|low|medium|high|xhigh). The dev fix (→ "low") was
committed but never redeployed, so users on the published build kept hitting the
old binary.

**Fix:** no code change needed if source is already correct — REDEPLOY the
api-server so production picks up the current build. Server-only param, so no
mobile rebuild is required for this particular fix.

**General lesson:** server-side fixes only reach published-app users after the
api-server deployment is republished; dev workflow correctness ≠ production
correctness. Always check deployment logs (not dev logs) for published-app bug
reports.

# Transient "There was a problem running the requested app / 404" page

A full-page HTML 404 titled "Run this app to see the results here" with a
"Go Home" button is the Replit deployment ROUTER placeholder shown when no server
is bound to the requested path at that instant — NOT a broken build. On an
**autoscale** deployment (deploymentTarget="autoscale" in .replit) this happens
during cold starts (scaled-to-zero → first request) or mid-redeploy windows.

**Confirm it's transient, not real:** curl the published host root directly
(domain is EXPO_PUBLIC_DOMAIN in stadium-mobile/eas.json, e.g.
`stadium-edge-1.replit.app`). If `GET /` returns 200 with the real app HTML
(`<title>Stadium Edge</title>`) and `/api/*` responds, the deployment is healthy
and the user just hit a cold-start blip — tell them to refresh. A bare
`/api/sports/odds` curl returns 400 (missing required `sport` query param), which
is healthy validation, not an outage.

**If it recurs often:** autoscale cold starts are inherent; a Reserved VM
(always-on) deployment avoids them — that's a user cost/config decision.
