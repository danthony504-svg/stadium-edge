import type { TextStyle } from "react-native";

/** Inter font family tokens — single typeface across Stadium Edge. */
export const FONT = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  /** @deprecated Use TYPE.* or FONT.bold — kept for gradual migration. */
  display: "Inter_700Bold",
  /** @deprecated Use TYPE.* or FONT.semibold */
  displaySemi: "Inter_600SemiBold",
  /** @deprecated Use FONT.regular */
  body: "Inter_400Regular",
} as const;

/** Tabular figures for odds, edge, confidence, records, percentages. */
export const TABULAR: Pick<TextStyle, "fontVariant"> = {
  fontVariant: ["tabular-nums"],
};

/** Stadium Edge typography scale — Inter only. */
export const TYPE = {
  displayTitle: {
    fontFamily: FONT.bold,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.5,
  },
  screenTitle: {
    fontFamily: FONT.bold,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.3,
  },
  sectionHeader: {
    fontFamily: FONT.bold,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.2,
  },
  cardTitle: {
    fontFamily: FONT.semibold,
    fontSize: 20,
    lineHeight: 26,
  },
  playerName: {
    fontFamily: FONT.semibold,
    fontSize: 18,
    lineHeight: 24,
  },
  body: {
    fontFamily: FONT.regular,
    fontSize: 16,
    lineHeight: 22,
  },
  secondary: {
    fontFamily: FONT.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  caption: {
    fontFamily: FONT.medium,
    fontSize: 13,
    lineHeight: 18,
  },
  button: {
    fontFamily: FONT.semibold,
    fontSize: 17,
    lineHeight: 22,
  },
} as const satisfies Record<string, TextStyle>;

export type TypographyToken = keyof typeof TYPE;

/** Merge a type token with tabular nums (odds, stats, records). */
export function numType(token: TypographyToken, extra?: TextStyle): TextStyle {
  return { ...TYPE[token], ...TABULAR, ...extra };
}

/** Apply tabular nums to any text style. */
export function withTabular(style: TextStyle): TextStyle {
  return { ...style, ...TABULAR };
}
