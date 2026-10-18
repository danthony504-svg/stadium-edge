# Preview OTA candidate — PR-A + PR-B + Stage 3 (no PR-C)

**Do not publish until authorized.**

| Field | Value |
|-------|--------|
| Candidate SHA | `82d8ba745da659c5d54eb378b973b8f5998d4f57` |
| Launch hash | `_MzbWLVZlWAbQXZijZ-YpJni3tEGqMEEIAPPGLYe_d8` |
| Hermes entry | `entry-a6709582754f1e83d102a4490477ab34.hbc` |
| Runtime | `1.1.0` |
| Base | `4887dc39` (Stage 3 ATD / Option C on main) |
| Includes | PR-A grounding (`6ca67490`), greenfield test pin (`8bd29f19`), PR-B deadline (`82d8ba74`) |
| Excludes | PR-C startsAt cache wiring, Stage 4 defenseIndex shadow |
| Target API | production `ea15ead0` (mobile-only delta) |
| Rollback group | `a4bad31e-d8a8-4047-bf74-87feddd8a928` (update `01a14f3e…`) |
| Frozen input (local) | `.ota-publish-input-pra-prb-stage3` (not committed) |

Publish (when authorized):
```bash
eas update --channel preview --platform ios --skip-bundler \
  --input-dir .ota-publish-input-pra-prb-stage3 \
  --message "preview 82d8ba74 — PR-A grounding + PR-B deadline + Stage3 ATD; no PR-C; rollback a4bad31e; no production"
```
