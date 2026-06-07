import React from "react";
import { View, Text } from "react-native";
import { FONT } from "@/components/ui";

// Lightweight markdown renderer for AI Coach replies. The model returns plain
// text with light markdown — **bold**, "* " / "- " bullets, "#"/"##"/"###"
// headers, and "---" / "⸻" section dividers. A single <Text> dump shows all of
// that as literal characters in a wall of text, so this splits the reply into
// spaced blocks (headers, bullets, dividers, paragraphs) for a clean, separated
// read. It never changes the content — only how it's laid out.

type Props = {
  text: string;
  // Body text colour (matches the bubble's foreground).
  color: string;
  // Dim colour for bullet glyphs and dividers.
  mutedColor: string;
};

// Split a line on **bold** spans and render each run with the right weight.
function renderInline(text: string, color: string, baseFont: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, j) => {
    if (part.length >= 4 && part.startsWith("**") && part.endsWith("**")) {
      return (
        <Text key={j} style={{ fontFamily: FONT.bold, color }}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    return (
      <Text key={j} style={{ fontFamily: baseFont, color }}>
        {part}
      </Text>
    );
  });
}

const DIVIDER_RE = /^(?:[-*_]\s?){3,}$|^[⸻―—–]+$/;
const HEADER_RE = /^(#{1,3})\s+(.+?)\s*#*$/;
const BULLET_RE = /^\s*(?:[*\-•])\s+(.+)$/;

export function ChatMarkdown({ text, color, mutedColor }: Props) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    // Blank line → vertical gap between blocks (collapse runs of blanks).
    if (!line) {
      const prev = blocks[blocks.length - 1];
      if (prev !== undefined) blocks.push(<View key={`sp${key++}`} style={{ height: 8 }} />);
      continue;
    }

    // Section divider.
    if (DIVIDER_RE.test(line) && /[-*_⸻―—–]/.test(line)) {
      blocks.push(
        <View
          key={`hr${key++}`}
          style={{ height: 1, backgroundColor: mutedColor, opacity: 0.25, marginVertical: 8 }}
        />,
      );
      continue;
    }

    // Header (# / ## / ###).
    const h = line.match(HEADER_RE);
    if (h) {
      const level = h[1].length;
      const size = level === 1 ? 17 : level === 2 ? 15.5 : 14.5;
      blocks.push(
        <Text
          key={`h${key++}`}
          selectable
          style={{
            color,
            fontFamily: FONT.bold,
            fontSize: size,
            lineHeight: size + 6,
            marginTop: blocks.length ? 6 : 0,
            marginBottom: 2,
          }}
        >
          {renderInline(h[2], color, FONT.bold)}
        </Text>,
      );
      continue;
    }

    // Bullet row (* / - / •) with a hanging indent.
    const b = line.match(BULLET_RE);
    if (b) {
      blocks.push(
        <View key={`b${key++}`} style={{ flexDirection: "row", paddingLeft: 2, marginVertical: 1 }}>
          <Text style={{ color: mutedColor, fontFamily: FONT.body, fontSize: 14, lineHeight: 21, marginRight: 7 }}>
            {"\u2022"}
          </Text>
          <Text selectable style={{ flex: 1, fontSize: 14, lineHeight: 21 }}>
            {renderInline(b[1], color, FONT.body)}
          </Text>
        </View>,
      );
      continue;
    }

    // Plain paragraph line.
    blocks.push(
      <Text key={`p${key++}`} selectable style={{ fontSize: 14, lineHeight: 21, marginVertical: 1 }}>
        {renderInline(line, color, FONT.body)}
      </Text>,
    );
  }

  return <View>{blocks}</View>;
}
