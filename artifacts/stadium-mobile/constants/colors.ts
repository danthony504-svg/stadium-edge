/**
 * Semantic design tokens for Stadium Edge mobile.
 *
 * A DARK-ONLY, high-contrast dashboard built on navy slate surfaces with a
 * single BLUE accent (blue-500 #3b82f6) used for every action/active state,
 * dark text sitting ON the blue (slate-950), darker slate-950 cards, and
 * slate-800 hairline borders. Both `light` and `dark` palettes are the same
 * dark values so the brand is identical regardless of the device appearance
 * setting.
 */

const dark = {
  // Legacy aliases (kept for backward compatibility)
  text: "#f1f5f9",
  tint: "#3b82f6",

  // Core surfaces
  background: "#0f172a", // slate-900
  foreground: "#f1f5f9", // slate-100

  // Cards / elevated surfaces — darker than the page, like the web cards
  card: "#020617", // slate-950
  cardForeground: "#f1f5f9",

  // A slightly raised surface for nested chips / inputs (sits above the card)
  surface: "#0f172a", // slate-900

  // Primary action color — the brand blue, with DARK text on top, used on
  // every button / active state across the app.
  primary: "#3b82f6", // blue-500
  primaryForeground: "#020617", // slate-950

  // Secondary / less-emphasis interactive surfaces
  secondary: "#1e293b",
  secondaryForeground: "#f1f5f9",

  // Muted / subdued elements (dividers, timestamps, placeholders)
  muted: "#1e293b",
  mutedForeground: "#94a3b8", // slate-400

  // Accent highlights — the same brand blue, used as a bright foreground accent
  // (icons / highlight text) on dark surfaces.
  accent: "#3b82f6", // blue-500
  accentForeground: "#020617", // slate-950

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
