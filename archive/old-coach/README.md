# Archived Stadium Edge AI Coach UI (legacy)

These files were removed from the active app bundle. They are kept here for
reference only — nothing in `artifacts/stadium-mobile` imports from this folder.

When we say "Coach" in Stadium Edge, we mean the **Stadium Edge AI Coach**
screen at `app/(tabs)/coach.tsx` only — not any external brand.

## Archived files

| File | Reason |
|------|--------|
| `components/CoachLearningPanel.tsx` | Never wired into navigation or `coach.tsx`; duplicate learning UI that could render an alternate look if re-imported. |
| `lib/coachSilentLaunch.ts` | Legacy Home one-tap launch hook used to auto-send builds with hidden bubbles. Replaced by idle `goCoach()` navigation. |

## Active Stadium Edge AI Coach (not archived)

- `artifacts/stadium-mobile/app/(tabs)/coach.tsx` — sole `CoachScreen` export and `/coach` route.

## Active AI Coach UI components (not archived)

- `components/AnalysisProgress.tsx` — current build progress (checklist + bar)
- `components/CoachTicketHeader.tsx` — ticket header above pick cards
- `components/PickCard.tsx` — pick cards
