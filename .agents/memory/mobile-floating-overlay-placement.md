---
name: Mobile floating-overlay placement (iOS native stack)
description: Why global floating overlays (SlipBar) must be rendered per-screen-stack, not once at the root layout, in stadium-mobile.
---

A root-level sibling overlay does NOT reliably paint over nested native-stack
content on iOS (react-native-screens). The SlipBar floating bet-slip popup placed
once in `app/_layout.tsx` (sibling of the ROOT Stack) was invisible on the tab
screens (e.g. Coach) even though its render logic was correct.

**Why:** expo-router/react-native-screens hosts each Stack's screens in native
view controllers. A JS sibling of the OUTER stack does not sit above the content
of an INNER (nested) stack's screens. The proof in-repo: `NavMenu` renders fine
because it lives INSIDE `(tabs)/_layout.tsx` as a sibling of the *nested* Stack.

**How to apply:** render a floating global overlay as a sibling of *each* screen's
own stack, not once at the root:
- `(tabs)/_layout.tsx` — one instance, sibling of the nested Stack (covers every
  tab). Put it before `<NavMenu/>` so the hamburger stays on top.
- Each ROOT-stack route that lives OUTSIDE the tabs (`game/[id]`, `upcoming`) —
  render its own instance as the last child of the screen's root View.
- A fullScreen RN `<Modal>` (e.g. `PlayerPropsSheet`) is its own layer — the
  tab/stack overlay can't show through it, so render an instance INSIDE the Modal
  too. Pass `onNavigateAway={onClose}` so "Open full slip" closes the modal first.

`BetSlipProvider` is above all screens, so every SlipBar instance shares one slip
state. No visible duplicates: a tab screen shows only the (tabs) instance; a
pushed root-stack card shows only its local instance (the tabs one is behind the
native screen).

**Keyboard note (same screen family):** `react-native-keyboard-controller`'s
`KeyboardAwareScrollView` already auto-adds `paddingBottom = keyboardHeight` and
scrolls the focused input into view, so it handles short content. If a stake/input
fix "doesn't work" after editing a `_layout`/navigation file, suspect a stale
Metro bundle (Fast Refresh often won't hot-swap layout/navigator changes) —
restart the expo workflow to push a fresh bundle before assuming the code is wrong.
