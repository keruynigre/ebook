import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, ui } from '../components/ui';
import { colors } from '../lib/theme';
import { removeWord, reviewWord, setKnown, useWords, wordKey, type SavedWord } from '../lib/wordbook';

type Filter = 'learn' | 'known' | 'all';

/** Saved words: a list, and a simple card review. */
export default function WordsScreen() {
  const words = useWords();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>('learn');
  const [review, setReview] = useState<{ queue: SavedWord[]; at: number; show: boolean; right: number } | null>(null);

  const list = useMemo(
    () => words.filter((w) => (filter === 'all' ? true : filter === 'known' ? !!w.known : !w.known)),
    [words, filter],
  );
  const toLearn = words.filter((w) => !w.known);

  const startReview = () => {
    // Least known first, then shuffled a little.
    const queue = [...toLearn]
      .map((w) => ({ w, r: (w.right ?? 0) / Math.max(1, w.seen ?? 0) + Math.random() * 0.3 }))
      .sort((a, b) => a.r - b.r)
      .slice(0, 20)
      .map((x) => x.w);
    if (queue.length) setReview({ queue, at: 0, show: false, right: 0 });
  };

  const answer = (knew: boolean) => {
    if (!review) return;
    const w = review.queue[review.at];
    reviewWord(w, knew).catch(() => undefined);
    setReview({ ...review, at: review.at + 1, show: false, right: review.right + (knew ? 1 : 0) });
  };

  const askRemove = (w: SavedWord) =>
    Alert.alert(w.word, undefined, [
      { text: w.known ? 'Öğrenilecek yap' : 'Öğrendim', onPress: () => setKnown(w, !w.known) },
      { text: 'Sil', style: 'destructive', onPress: () => removeWord(w) },
      { text: 'Vazgeç', style: 'cancel' },
    ]);

  if (review) {
    const w = review.queue[review.at];
    return (
      <View style={{ flex: 1, padding: 16, gap: 12, paddingBottom: insets.bottom + 16 }}>
        {w ? (
          <>
            <Text style={ui.muted}>
              {review.at + 1} / {review.queue.length}
            </Text>
            <Card style={{ gap: 12, paddingVertical: 24 }}>
              <Text style={{ color: colors.text, fontSize: 28, fontWeight: '700', textAlign: 'center' }}>{w.word}</Text>
              {!!w.sentence && <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21, fontStyle: 'italic' }}>“{w.sentence}”</Text>}
              {review.show && <Text style={{ color: colors.accent, fontSize: 20, fontWeight: '600', textAlign: 'center' }}>{w.meaning || '—'}</Text>}
            </Card>
            {review.show ? (
              <View style={ui.row}>
                <Button title="Bilmiyordum" variant="secondary" onPress={() => answer(false)} style={{ flex: 1 }} />
                <Button title="Biliyordum" onPress={() => answer(true)} style={{ flex: 1 }} />
              </View>
            ) : (
              <Button title="Anlamını göster" onPress={() => setReview({ ...review, show: true })} />
            )}
            <Button title="Bitir" variant="secondary" onPress={() => setReview(null)} />
          </>
        ) : (
          <>
            <Card style={{ gap: 8 }}>
              <Text style={ui.h2}>Tekrar bitti</Text>
              <Text style={ui.text}>
                {review.queue.length} kelimeden {review.right} tanesini bildin. İki kez bildiğin kelimeler “Öğrendiklerim”e geçer.
              </Text>
            </Card>
            <Button title="Yeniden tekrar et" onPress={startReview} disabled={!toLearn.length} />
            <Button title="Listeye dön" variant="secondary" onPress={() => setReview(null)} />
          </>
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 16, gap: 10, paddingBottom: insets.bottom }}>
      <Text style={ui.muted}>
        Okurken bir kelimeye dokunup baloncukta “☆ Kaydet”e basınca buraya eklenir. Kelimeye basılı tutarak silebilir ya da
        öğrendim diye işaretleyebilirsin.
      </Text>
      <Button title={`Tekrar et · ${toLearn.length} kelime`} onPress={startReview} disabled={!toLearn.length} />
      <View style={ui.row}>
        {(
          [
            ['learn', `Öğrenilecek (${toLearn.length})`],
            ['known', `Öğrendiklerim (${words.length - toLearn.length})`],
            ['all', 'Tümü'],
          ] as [Filter, string][]
        ).map(([f, label]) => (
          <Button key={f} small title={label} variant={filter === f ? 'primary' : 'secondary'} onPress={() => setFilter(f)} style={{ flex: 1 }} />
        ))}
      </View>
      <FlatList
        data={list}
        keyExtractor={(w) => wordKey(w)}
        contentContainerStyle={{ gap: 8, paddingBottom: 24 }}
        ListEmptyComponent={<Text style={[ui.muted, { textAlign: 'center', marginTop: 24 }]}>Burada henüz kelime yok.</Text>}
        renderItem={({ item: w }) => (
          <Pressable
            onLongPress={() => askRemove(w)}
            onPress={() =>
              w.bookId !== undefined && w.chapter !== undefined
                ? router.push({ pathname: '/read/[id]/[index]', params: { id: w.bookId, index: String(w.chapter) } })
                : undefined
            }
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>{w.word}</Text>
              <Text style={{ color: colors.accent, fontSize: 15, flexShrink: 1 }}>{w.meaning}</Text>
            </View>
            {!!w.sentence && (
              <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 18, fontStyle: 'italic' }} numberOfLines={2}>
                {w.sentence}
              </Text>
            )}
            {(!!w.bookTitle || w.chapter !== undefined) && (
              <Text style={{ color: colors.muted, fontSize: 11 }}>
                {w.bookTitle ?? ''}
                {w.chapter !== undefined ? ` · ${w.chapter + 1}. bölüm` : ''}
              </Text>
            )}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: colors.card, borderRadius: 12, padding: 12, gap: 4 },
});
