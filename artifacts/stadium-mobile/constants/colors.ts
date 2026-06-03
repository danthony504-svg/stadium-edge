/**
 * Semantic design tokens for Stadium Edge mobile.
 *
 * Mirrors the sibling web artifact (artifacts/stadium-edge): a DARK-ONLY,
 * high-contrast dashboard built on navy slate surfaces with a single CYAN
 * accent (cyan-400 #22d3ee) used for every action/active state, dark text
 * sitting ON the cyan (slate-950), darker slate-950 cards, and slate-800
 * hairline borders. Both `light` and `dark` palettes are the same dark values
 * so the brand is identical regardless of the device appearance setting.
 */

const dark = {
  // Legacy aliases (kept for backward compatibility)
  text: "#f1f5f9",
  tint: "#22d3ee",

  // Core surfaces
  background: "#0f172a", // slate-900
  foreground: "#f1f5f9", // slate-100

  // Cards / elevated surfaces — darker than the page, like the web cards
  card: "#020617", // slate-950
  cardForeground: "#f1f5f9",

  // A slightly raised surface for nested chips / inputs (sits above the card)
  surface: "#0f172a", // slate-900

  // Primary action color — the brand cyan, with DARK text on top (web uses
  // bg-cyan-400 text-slate-950 on every button / active state)
  primary: "#22d3ee", // cyan-400
  primaryForeground: "#020617", // slate-950

  // Secondary / less-emphasis interactive surfaces
  secondary: "#1e293b",
  secondaryForeground: "#f1f5f9",

  // Muted / subdued elements (dividers, timestamps, placeholders)
  muted: "#1e293b",
  mutedForeground: "#94a3b8", // slate-400

  // Accent highlights — a deeper cyan for gradients / secondary emphasis
  accent: "#06b6d4", // cyan-500
  accentForeground: "#0f172a",

  // Destructive actions (delete, error states)
  destructive: "#ef4444",
  destructiveForeground: "#ffffff",

  // Status colors
  success: "#10b981", // emerald-500 (matches web)
  warning: "#f59e0b",
  live: "#f43f5e", // rose-500 (matches web)

  // Borders and input outlines
  border: "#1e293b", // slate-800
  input: "#1e293b",
};

const colors = {
  light: dark,
  dark,

  // Border radius (in px). Web cards/pills use rounded-2xl (16px).
  radius: 16,
};

export default colors;
