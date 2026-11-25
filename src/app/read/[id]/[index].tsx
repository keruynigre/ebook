import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, ui } from '../../../components/ui';
import { useBook } from '../../../lib/library';
import { loadChapter } from '../../../lib/storage';
import { colors } from '../../../lib/theme';
import type { ChapterContent } from '../../../lib/types';

/** A simple reader, mainly to check that chapters were cleaned well. */
export default function Reader() {
  const { id, index } = useLocalSearchParams<{ id: string; index: string }>();
  const i = parseInt(index, 10);
  const book = useBook(id);
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollViewInstance>(null);
  const [chapter, setChapter] = useState<ChapterContent | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    setChapter(undefined);
    loadChapter(id, i)
      .then((c) => alive && setChapter(c))
      .catch(() => alive && setChapter(null));
    scroll.current?.scrollTo({ y: 0, animated: false });
    return () => {
      alive = false;
    };
  }, [id, i]);

  const has = (k: number) => !!book?.downloaded.includes(k);
  const go = (k: number) => router.setParams({ index: String(k) });
  const title = book?.chapters[i]?.title ?? chapter?.title ?? '';

  return (
    <View style={ui.screen}>
      <Stack.Screen options={{ title: `${i + 1}. bölüm` }} />
      <ScrollView ref={scroll} contentContainerStyle={{ padding: 20, paddingBottom: 24 + insets.bottom }}>
        <Text style={[ui.h1, { marginBottom: 16 }]}>{title}</Text>
        {chapter === null && <Text style={ui.error}>Bu bölüm indirilmemiş.</Text>}
        {chapter?.paragraphs.map((p, k) => (
          <Text key={k} style={{ color: colors.text, fontSize: 17, lineHeight: 27, marginBottom: 14 }}>
            {p}
          </Text>
        ))}
        <View style={[ui.row, { marginTop: 12 }]}>
          <Button title="‹ Önceki" variant="secondary" onPress={() => go(i - 1)} disabled={!has(i - 1)} style={{ flex: 1 }} />
          <Button title="Sonraki ›" variant="secondary" onPress={() => go(i + 1)} disabled={!has(i + 1)} style={{ flex: 1 }} />
        </View>
      </ScrollView>
    </View>
  );
}
