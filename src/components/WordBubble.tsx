import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { lookupWord, type WordMeaning } from '../lib/dictionary';
import { colors } from '../lib/theme';

export interface BubbleTarget {
  word: string;
  sentence: string;
  lang: 'tr' | 'en';
  x: number;
  y: number;
}

interface Palette {
  card: string;
  text: string;
  muted: string;
  border: string;
}

const WIDTH = 300;

export function WordBubble({
  target,
  palette,
  onClose,
  onReadHere,
}: {
  target: BubbleTarget | null;
  palette: Palette;
  onClose: () => void;
  onReadHere?: () => void;
}) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [result, setResult] = useState<{ key: string; meaning?: WordMeaning; error?: string } | null>(null);
  const key = target ? `${target.lang}:${target.word}:${target.sentence}` : '';

  useEffect(() => {
    if (!target) return;
    let alive = true;
    lookupWord(target.word, target.sentence, target.lang)
      .then((meaning) => alive && setResult({ key, meaning }))
      .catch((e: Error) => alive && setResult({ key, error: e.message }));
    return () => {
      alive = false;
    };
  }, [target, key]);

  if (!target) return null;
  const current = result?.key === key ? result : null;
  const width = Math.min(WIDTH, screenW - 24);
  const left = Math.max(12, Math.min(screenW - width - 12, target.x - width / 2));
  const below = target.y < screenH * 0.55;
  const arrowLeft = Math.max(14, Math.min(width - 26, target.x - left - 6));
  const m = current?.meaning;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View
        style={[
          styles.card,
          { width, left, backgroundColor: palette.card, borderColor: palette.border },
          below ? { top: target.y + 18 } : { bottom: screenH - target.y + 14 },
        ]}
      >
        <View
          style={[
            styles.arrow,
            { left: arrowLeft, backgroundColor: palette.card, borderColor: palette.border },
            below ? { top: -7, borderRightWidth: 0, borderBottomWidth: 0 } : { bottom: -7, borderLeftWidth: 0, borderTopWidth: 0 },
          ]}
        />
        <View style={styles.head}>
          <Text style={[styles.word, { color: palette.text }]}>{target.word}</Text>
          {!!m?.headword && m.headword.toLocaleLowerCase('tr') !== target.word.toLocaleLowerCase('tr') && (
            <Text style={{ color: palette.muted, fontSize: 13 }}>← {m.headword}</Text>
          )}
        </View>
        {!current && (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} />
            <Text style={{ color: palette.muted, fontSize: 13 }}>Anlamına bakılıyor…</Text>
          </View>
        )}
        {current?.error && <Text style={{ color: palette.muted, fontSize: 14 }}>{current.error}</Text>}
        {m && (
          <View style={{ gap: 6 }}>
            {!!m.translation && <Text style={styles.translation}>{m.translation}</Text>}
            {m.senses.slice(0, 4).map((s, k) => (
              <Text key={k} style={{ color: palette.text, fontSize: 14, lineHeight: 20 }}>
                {!!s.label && <Text style={{ color: palette.muted, fontStyle: 'italic' }}>{s.label}  </Text>}
                {s.items.join(m.source === 'TDK Sözlük' || m.source === 'Gemini' ? '\n' : ', ')}
              </Text>
            ))}
          </View>
        )}
        <View style={styles.foot}>
          <Text style={{ color: palette.muted, fontSize: 11 }}>{m?.source ?? ''}</Text>
          {onReadHere && (
            <Pressable onPress={onReadHere} hitSlop={8}>
              <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '700' }}>▶ Buradan oku</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  arrow: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderWidth: StyleSheet.hairlineWidth,
    transform: [{ rotate: '45deg' }],
  },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  word: { fontSize: 19, fontWeight: '700' },
  translation: { color: colors.accent, fontSize: 17, fontWeight: '600' },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  foot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
});
