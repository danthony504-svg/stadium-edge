---
name: Chat composer hidden behind keyboard
description: Why the AI Coach text input vanishes when the iOS keyboard opens and the fix.
---
# Chat composer must be KeyboardStickyView, not just a sibling of KeyboardAwareScrollView

The AI Coach screen (`app/(tabs)/coach.tsx`) lays out: header, a
`KeyboardAwareScrollViewCompat` (flex:1) for messages, then the composer
(TextInput + send) as a **sibling View AFTER** the scroll view.

`KeyboardAwareScrollView` only scrolls *its own content* so a focused input
*inside it* stays visible. The composer's TextInput lives OUTSIDE the scroll
view, so the scroll view's avoidance does nothing for it — when the iOS keyboard
opens, the composer stays at the screen bottom and the keyboard covers it. Symptom
the user reports: "can't see the search bar in chat."

**Fix:** wrap the composer in `<KeyboardStickyView>` from
`react-native-keyboard-controller` (already initialized via `KeyboardProvider`
in the root layout). It translates the wrapped view up by the keyboard height.

**Offset gotcha:** the composer keeps `paddingBottom: insets.bottom + 10` for the
home-indicator gap when closed. Use `offset={{ closed: 0, opened: insets.bottom }}`
so when the keyboard opens that bottom safe-area padding is consumed and the input
sits ~10px above the keyboard instead of leaving an `insets.bottom` dead gap.

**Web:** `KeyboardStickyView` is safe to use directly (no web branch needed) —
the library ships no-op web bindings, so it degrades gracefully. Verified rendering
fine in the web preview.
