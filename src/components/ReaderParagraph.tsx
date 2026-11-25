import { memo, useMemo } from 'react';
import { Text, type GestureResponderEvent, type LayoutChangeEvent, type TextStyle } from 'react-native';

import { tokenize } from '../lib/words';

export interface WordTap {
  para: number;
  word: string;
  /** Character range of the word inside the paragraph. */
  start: number;
  end: number;
  x: number;
  y: number;
}

interface Props {
  index: number;
  text: string;
  style: TextStyle;
  /** Spoken word range to highlight (-1 for none). */
  hlStart: number;
  hlEnd: number;
  hlColor: string;
  onWord: (tap: WordTap) => void;
  onLayout: (index: number, e: LayoutChangeEvent) => void;
}

/** One paragraph of the reader; every word can be tapped. Memoized so highlight changes re-render only one paragraph. */
export const ReaderParagraph = memo(function ReaderParagraph({ index, text, style, hlStart, hlEnd, hlColor, onWord, onLayout }: Props) {
  const tokens = useMemo(() => tokenize(text), [text]);
  return (
    <Text selectable style={style} onLayout={(e) => onLayout(index, e)}>
      {tokens.map((t) => {
        const lit = hlStart >= 0 && t.start < hlEnd && t.start + t.text.length > hlStart;
        if (!t.word) return lit ? <Text key={t.start} style={{ backgroundColor: hlColor }}>{t.text}</Text> : t.text;
        return (
          <Text
            key={t.start}
            style={lit ? { backgroundColor: hlColor } : undefined}
            onPress={(e: GestureResponderEvent) =>
              onWord({
                para: index,
                word: t.text,
                start: t.start,
                end: t.start + t.text.length,
                x: e.nativeEvent.pageX,
                y: e.nativeEvent.pageY,
              })
            }
          >
            {t.text}
          </Text>
        );
      })}
    </Text>
  );
});
