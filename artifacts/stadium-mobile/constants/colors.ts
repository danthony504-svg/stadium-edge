/**
 * Semantic design tokens for Stadium Edge mobile.
 *
 * Mirrors the sibling web artifact (artifacts/stadium-edge/src/index.css),
 * which is DARK-ONLY: navy slate surfaces with blue + cyan accents. To keep
 * the brand identical regardless of the device appearance setting, both the
 * `light` and `dark` palettes are the same dark values (the app is always dark).
 */

const dark = {
  // Legacy aliases (kept for backward compatibility)
  text: "#f1f5f9",
  tint: "#2563eb",

  // Core surfaces
  background: "#0f172a", // slate-900
  foreground: "#f1f5f9", // slate-100

  // Cards / elevated surfaces
  card: "#1e293b", // slate-800
  cardForeground: "#f1f5f9",

  // A slightly deeper surface for nested panels / inputs
  surface: "#0b1220",

  // Primary action color (buttons, links, active states)
  primary: "#2563eb", // blue-600
  primaryForeground: "#ffffff",

  // Secondary / less-emphasis interactive surfaces
  secondary: "#1e293b",
  secondaryForeground: "#f1f5f9",

  // Muted / subdued elements (dividers, timestamps, placeholders)
  muted: "#1e293b",
  mutedForeground: "#94a3b8", // slate-400

  // Accent highlights (badges, selected items, focus rings)
  accent: "#06b6d4", // cyan-500
  accentForeground: "#0f172a",

  // Destructive actions (delete, error states)
  destructive: "#ef4444",
  destructiveForeground: "#ffffff",

  // Status colors
  success: "#22c55e",
  warning: "#f59e0b",
  live: "#ef4444",

  // Borders and input outlines
  border: "#334155", // slate-700
  input: "#1e293b",
};

const colors = {
  light: dark,
  dark,

  // Border radius (in px). Web uses generous rounding on cards/pills.
  radius: 14,
};

export default colors;
