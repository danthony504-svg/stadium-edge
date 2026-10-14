# Where preview commands run — `EXPO_TOKEN` placement

## Runtime for this agent

| Fact | Value |
|------|--------|
| Host | **Cursor Cloud Agent VM** (not GitHub Actions) |
| Run URL | https://cursor.com/agents/bc-01a08078-c90e-7d1f-a483-e252c105def8 |
| Repo checkout | `/workspace` on branch `cursor/build78-fixpack-def8` |
| Commands | `eas device:create`, `eas build --profile preview-build78`, `prepare-preview-test.sh` / `publish-preview-ota.sh` |

A **GitHub Actions secret named `EXPO_TOKEN` is not injected into this VM**. Codex / Cloud Agent tasks only see secrets configured on the **Cursor environment** (or exported into the shell for that session).

## Secure configuration (pick one)

1. **Preferred — Cursor environment secret**  
   Open this environment → Secrets → add `EXPO_TOKEN` (Expo access token with EAS Build + Update + device registration scope):  
   https://cursor.com/dashboard/cloud-agents/environments/e/8c5427d9-a490-11f1-a7d1-d6b4613131ce  
   Create the token at https://expo.dev/settings/access-tokens (do **not** paste it into chat).  
   After saving, **start a new agent run** (or re-inject secrets) so `process.env.EXPO_TOKEN` is present — existing pods often do not see secrets added mid-run.

2. **Session-only (manual)**  
   In the agent / local shell (value never pasted into chat):
   ```bash
   export EXPO_TOKEN=…   # from https://expo.dev/settings/access-tokens
   ```

3. **Not sufficient**  
   - GitHub repo secret alone  
   - `.env` committed to git  
   - Printing the token in logs / PR bodies  

## Verify without leaking

```bash
python3 -c 'import os; print("EXPO_TOKEN_configured=", bool(os.environ.get("EXPO_TOKEN","").strip()))'
# Expect: EXPO_TOKEN_configured= True
```

`prepare-preview-test.sh` and `publish-preview-ota.sh` read `EXPO_TOKEN` from the environment and **never echo it**.
