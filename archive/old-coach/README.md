# Archived old Coach UI

These files were removed from the active app bundle on 2026-07-18. They are
kept here for reference only — nothing in `artifacts/stadium-mobile` imports
from this folder.

## Archived files

| File | Reason |
|------|--------|
| `components/CoachLearningPanel.tsx` | Never wired into navigation or `coach.tsx`; duplicate learning UI that could render an alternate Coach look if re-imported. |
| `lib/coachSilentLaunch.ts` | Legacy Home one-tap launch hook (`markCoachHomeLaunch` / `takeCoachLaunch`) used to auto-send builds with hidden bubbles. Replaced by idle `goCoach()` navigation — Home opens Coach without starting a build. |

## Active Coach screen (not archived)

- `artifacts/stadium-mobile/app/(tabs)/coach.tsx` — sole `CoachScreen` export and `/coach` route.

## Active Coach UI components (not archived)

- `components/AnalysisProgress.tsx` — current build progress (checklist + bar)
- `components/CoachTicketHeader.tsx` — current ticket header above pick cards
- `components/PickCard.tsx` — current pick cards
