import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, ProgressBar } from '../../../components/ui';
import { ensureComic, loadComicScript, panelFile, redoChapter, redrawPanel, stopComics, useComicJob, useComicVersion, type ComicScript } from '../../../lib/comic';
import type { ComicBubble } from '../../../lib/comicCore';
import { useBook } from '../../../lib/library';
import { useSettings } from '../../../lib/settings';

const PAPER = '#f4f1ea';
const INK = '#111111';

function Bubble({ b, lang, align }: { b: ComicBubble; lang: 'tr' | 'en'; align: 'flex-start' | 'flex-end' }) {
  const text = lang === 'tr' ? b.tr : b.en;
  if (b.kind === 'narration') {
    return (
      <View style={styles.caption}>
        <Text style={styles.captionText}>{text}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.bubble, b.kind === 'thought' && styles.thought, { alignSelf: align }]}>
      {!!b.speaker && <Text style={styles.speaker}>{b.speaker}</Text>}
      <Text style={[styles.bubbleText, b.kind === 'thought' && { fontStyle: 'italic' }]}>{text}</Text>
    </View>
  );
}

export default function ComicScreen() {
  const { id, index } = useLocalSearchParams<{ id: string; index: string }>();
  const i = parseInt(index, 10) || 0;
  const book = useBook(id);
  const settings = useSettings();
  const job = useComicJob(id, i);
  const v = useComicVersion();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const lang: 'tr' | 'en' = settings.showTranslation ? 'tr' : 'en';
  const [script, setScript] = useState<ComicScript | null | undefined>(undefined);
  const ready = settings.hasCfToken && !!settings.cfAccountId && settings.hasGeminiKey;

  // Start drawing as soon as the chapter is opened.
  useEffect(() => {
    if (ready && book?.downloaded.includes(i)) ensureComic(id, i);
  }, [id, i, ready, book?.downloaded]);

  useEffect(() => {
    let alive = true;
    loadComicScript(id, i).then((s) => alive && setScript(s));
    return () => {
      alive = false;
    };
  }, [id, i, v]);

  // Draw the next chapter ahead once this one is finished.
  const total = book?.chapters.length ?? 0;
  const next = i + 1 < total && book?.downloaded.includes(i + 1) ? i + 1 : -1;
  useEffect(() => {
    if (ready && job && !job.running && !job.error && job.total > 0 && job.done === job.total && next >= 0) ensureComic(id, next);
  }, [ready, job, next, id]);

  const go = (k: number) => router.setParams({ index: String(k) });
  const side = width - 24;

  const panelMenu = (p: number) =>
    Alert.alert(`${p + 1}. kare`, 'Bu kare beğenmediysen yeniden çizilebilir.', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Yeniden çiz', onPress: () => redrawPanel(id, i, p) },
    ]);

  const redoAll = () =>
    Alert.alert('Bölüm baştan çizilsin mi?', 'Sahneler yeniden seçilir ve bütün kareler yeniden çizilir (günlük çizim hakkından düşer).', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Baştan çiz', style: 'destructive', onPress: () => redoChapter(id, i) },
    ]);

  const header = (
    <View style={{ gap: 10, paddingBottom: 12 }}>
      <Text style={styles.title}>{book?.chapters[i]?.title ?? ''}</Text>
      {!ready && (
        <View style={{ gap: 8 }}>
          <Text style={styles.note}>Resimli okuma için Ayarlar’dan Cloudflare anahtarını (ve Gemini anahtarını) girmen gerekiyor.</Text>
          <Button title="Ayarlara git" onPress={() => router.push('/settings')} />
        </View>
      )}
      {ready && !book?.downloaded.includes(i) && <Text style={styles.note}>Bu bölüm henüz indirilmedi.</Text>}
      {job?.running && (
        <View style={{ gap: 6 }}>
          <ProgressBar value={job.total ? job.done / job.total : 0} />
          <Text style={styles.note}>
            {job.message}
            {job.total ? ` · ${job.done}/${job.total}` : ''}
          </Text>
          <Button small variant="secondary" title="Durdur" onPress={stopComics} />
        </View>
      )}
      {!!job?.error && (
        <View style={{ gap: 6 }}>
          <Text style={styles.error}>{job.error}</Text>
          {ready && <Button small title="Tekrar dene" onPress={() => ensureComic(id, i)} />}
        </View>
      )}
      {!!job?.message && !job.running && !job.error && <Text style={styles.note}>{job.message}</Text>}
    </View>
  );

  const footer = (
    <View style={{ gap: 10, paddingTop: 8, paddingBottom: insets.bottom + 24 }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {i > 0 && <Button variant="secondary" title="‹ Önceki" onPress={() => go(i - 1)} style={{ flex: 1 }} />}
        {i + 1 < total && <Button title="Sonraki ›" onPress={() => go(i + 1)} style={{ flex: 1 }} />}
      </View>
      <Button small variant="secondary" title="Bölümü yazı olarak oku" onPress={() => router.replace(`/read/${id}/${i}`)} />
      {!!script && !job?.running && <Button small variant="danger" title="Bu bölümü baştan çiz" onPress={redoAll} />}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: PAPER }}>
      <Stack.Screen
        options={{
          title: total ? `Resimli · ${i + 1} / ${total}` : 'Resimli',
          headerStyle: { backgroundColor: PAPER },
          headerTintColor: INK,
          contentStyle: { backgroundColor: PAPER },
        }}
      />
      <FlatList
        data={script?.panels ?? []}
        keyExtractor={(_, k) => `${i}-${k}`}
        contentContainerStyle={{ padding: 12 }}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        ListEmptyComponent={
          script === undefined || job?.running ? <ActivityIndicator color={INK} style={{ marginTop: 40 }} /> : undefined
        }
        renderItem={({ item, index: p }) => {
          const f = panelFile(id, i, p);
          const narration = item.bubbles.filter((b) => b.kind === 'narration');
          const talk = item.bubbles.filter((b) => b.kind !== 'narration');
          return (
            <View style={{ marginBottom: 18, gap: 8 }}>
              {narration.map((b, k) => (
                <Bubble key={`n${k}`} b={b} lang={lang} align="flex-start" />
              ))}
              <Pressable onLongPress={() => panelMenu(p)} delayLongPress={450}>
                {f.exists ? (
                  <Image
                    source={{ uri: f.uri }}
                    style={[styles.panel, { width: side, height: side }]}
                    contentFit="cover"
                    cachePolicy="none"
                    recyclingKey={`${i}-${p}-${v}`}
                  />
                ) : (
                  <View style={[styles.panel, styles.empty, { width: side, height: side }]}>
                    {job?.running ? <ActivityIndicator color={INK} /> : <Text style={styles.note}>Çizilmedi (uzun bas: yeniden çiz)</Text>}
                  </View>
                )}
              </Pressable>
              {talk.map((b, k) => (
                <Bubble key={`t${k}`} b={b} lang={lang} align={k % 2 ? 'flex-end' : 'flex-start'} />
              ))}
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: INK, fontSize: 20, fontWeight: '800' },
  note: { color: '#555', fontSize: 14 },
  error: { color: '#b3261e', fontSize: 14 },
  panel: { borderWidth: 3, borderColor: INK, backgroundColor: '#ddd' },
  empty: { alignItems: 'center', justifyContent: 'center' },
  bubble: {
    maxWidth: '85%',
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: INK,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  thought: { borderStyle: 'dashed', borderRadius: 30 },
  speaker: { color: INK, fontSize: 12, fontWeight: '800', marginBottom: 2 },
  bubbleText: { color: INK, fontSize: 16, lineHeight: 22 },
  caption: { backgroundColor: '#fffbe8', borderWidth: 2, borderColor: INK, paddingHorizontal: 12, paddingVertical: 6 },
  captionText: { color: INK, fontSize: 15, lineHeight: 21, fontStyle: 'italic' },
});
