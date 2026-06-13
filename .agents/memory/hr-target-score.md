---
name: HR Target Score + pitcher Statcast feed
description: Real Baseball Savant pitcher barrel%/hard-hit% ALLOWED feed + weighted 7-factor mobile HR Target Score; honesty + sample-gate rules.
---

# Pitcher Statcast feed (Baseball Savant)

- The ONLY Statcast numbers in the app are the OPPOSING STARTER's `barrelPctAllowed` / `hardHitPctAllowed` (batted-ball quality ALLOWED) + `battedBallEvents` (sample size). Sourced from the Savant pitcher CSV leaderboard, name-keyed (diacritic-stripped, letters-only normName), fail-closed empty map.
- **Why:** the app's hard honesty rule bans fabricated stats. These two ARE real measured numbers now, so the chat NEVER-FABRICATE clause was carved to allow ONLY pitcher-allowed barrel/hard-hit; ALL batter Statcast (batter barrel, exit velo, launch angle, batter hard-hit, batter FB/pull, pitch-mix, live fatigue, day/night HR split) stays BANNED.
- **How to apply:** any new MLB Statcast surface must keep the pitcher-allowed vs batter-banned boundary. `tendency.flyBallPct` is the PITCHER's ESPN batted-ball share — it is NOT a Statcast batter metric.

# 7-factor HR Target Score (mobile, batter HR props only)

- Pure fn `lib/hrScore.ts`: weights HR/9 25, Barrel% 20, HardHit% 15, FlyBall 15, Park 10, Platoon 10, Weather 5. Each → 0..1 favorability via linear anchors over real values; **renormalize over only the present (non-null) factors**; null → excluded (reported in `excluded[]`), never guessed; zero present → null score.
- **Sample gate is STRICT:** barrel/hard-hit count ONLY when `battedBallEvents >= 40` — null/unknown sample EXCLUDES them (both in hrScore AND propFactors `scReliable`). Earlier non-strict `bbe == null || bbe >= 40` was a code-review-flagged honesty gap (unknown sample leaked into the read).
- **Why:** an unverifiable / tiny Statcast sample is a shaky read; excluding it is more honest than citing it. In practice the Savant CSV always carries `attempts`, so null-bbe is the defensive/ESPN-only-tendency case.
- Dome = present, weather-NEUTRAL 0.5 (climate-controlled is a real fact); outdoor with null temp = excluded (no trustworthy wind direction in the feed).
