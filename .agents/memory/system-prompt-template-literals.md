---
name: System-prompt template-literal escaping
description: chat.ts SYSTEM_PROMPT is a backtick literal — never embed ${...} inside or the build dies.
---

`artifacts/api-server/src/routes/chat.ts` defines SYSTEM_PROMPT as a JS template literal (backticks). Any `${...}` written inside it is evaluated at parse time, not preserved as text — and if the contents aren't valid expressions (e.g. `${sport}` with no in-scope `sport` variable), esbuild fails with "Expected ';' but found '$'" and the API server won't boot.

**Why:** I wrote ``opponentDefense[`${sport}#${opponentTeamId}`]`` inside the prompt as documentation for the AI of how to look up a key, and the whole build broke. Fix was to rewrite the placeholder as plain text: `"<sport>#<opponentTeamId>"`.

**How to apply:** when describing key shapes / interpolation / code snippets to the AI inside SYSTEM_PROMPT, use angle-bracket or quote-style placeholders ("<sport>#<teamId>", "Player Name#athleteId"), never JS template syntax. If you really need a literal `${` in prompt text, escape as `\${`.
