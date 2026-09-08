import type { ReactNode } from "react";
import { Text, type TextProps, type TextStyle } from "react-native";

import { TYPE, TABULAR, type TypographyToken } from "@/lib/typography";
import { useColors } from "@/hooks/useColors";

type TypeProps = TextProps & {
  children: ReactNode;
  color?: string;
  style?: TextStyle;
};

function TypeBase({
  token,
  children,
  color,
  style,
  tabular,
  ...rest
}: TypeProps & { token: TypographyToken; tabular?: boolean }) {
  const colors = useColors();
  return (
    <Text
      {...rest}
      style={[
        TYPE[token],
        tabular ? TABULAR : null,
        { color: color ?? colors.foreground },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function DisplayTitle(props: TypeProps) {
  return <TypeBase token="displayTitle" {...props} />;
}

export function ScreenTitle(props: TypeProps) {
  return <TypeBase token="screenTitle" {...props} />;
}

export function SectionHeaderText(props: TypeProps) {
  return <TypeBase token="sectionHeader" {...props} />;
}

export function CardTitle(props: TypeProps) {
  return <TypeBase token="cardTitle" {...props} />;
}

export function PlayerName(props: TypeProps) {
  return <TypeBase token="playerName" {...props} />;
}

export function BodyText(props: TypeProps) {
  return <TypeBase token="body" {...props} />;
}

export function SecondaryText(props: TypeProps) {
  return <TypeBase token="secondary" {...props} />;
}

export function CaptionText(props: TypeProps) {
  return <TypeBase token="caption" {...props} />;
}

export function ButtonText(props: TypeProps) {
  return <TypeBase token="button" {...props} />;
}

/** Odds, edge, confidence, ROI, records — Inter + tabular alignment. */
export function StatValue(props: TypeProps & { token?: TypographyToken }) {
  return <TypeBase token={props.token ?? "cardTitle"} tabular {...props} />;
}
