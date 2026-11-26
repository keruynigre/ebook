import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, ProgressBar, ui } from '../../components/ui';
import { useBook } from '../../lib/library';
import { formatCount, isFinished, summarize, wordsRead } from '../../lib/readStats';
import { useSettings } from '../../lib/settings';
import { backfillReadStats } from '../../lib/statsBackfill';
import { colors } from '../../lib/theme';

export default function StatsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const book = useBook(id);
  const settings = useSettings();
  const insets = useSafeAreaInsets();
  const [counting, setCounting] = useState<{ done: number; total: number } | null>(null);

  // Chapters read before statistics existed are counted once, in the background.
  const needsBackfill = !!book && !book.readStatsBackfilled;
  useEffect(() => {
    if (!needsBackfill) return;
    let stop = false;
    backfillReadStats(id, settings.showTranslation, (done, total) => !stop && setCounting({ done, total }), () => stop)
      .catch(() => undefined)
      .finally(() => !stop && setCounting(null));
    return () => {
      stop = true;
    };
  }, [id, needsBackfill, settings.showTranslation]);

  const rows = useMemo(
    () =>
      Object.entries(book?.readStats ?? {})
        .map(([k, s]) => ({ index: Number(k), ...s }))
        .sort((a, b) => b.index - a.index),
    [book?.readStats],
  );
  const sum = useMemo(() => summarize(book?.readStats), [book?.readStats]);

  if (!book) return <View style={ui.screen} />;
  const avg = sum.finished ? Math.round(rows.filter(isFinished).reduce((n, r) => n + r.words, 0) / sum.finished) : 0;

  return (
    <FlatList
      style={ui.screen}
      contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 16 + insets.bottom }}
      data={rows}
      keyExtractor={(r) => String(r.index)}
      initialNumToRender={20}
      ListHeaderComponent={
        <View style={{ gap: 12, marginBottom: 8 }}>
          <Card style={{ gap: 10 }}>
            <Text style={ui.h2}>{book.title}</Text>
            <View style={styles.tiles}>
              <Tile label="Okunan kelime" value={formatCount(sum.wordsRead)} />
              <Tile label="Biten bölüm" value={formatCount(sum.finished)} />
            </View>
            <View style={styles.tiles}>
              <Tile label="Açılan bölüm" value={formatCount(sum.opened)} />
              <Tile label="Bölüm başına" value={avg ? `~${formatCount(avg)}` : '–'} />
            </View>
            {counting && (
              <View style={{ gap: 6 }}>
                <ProgressBar value={counting.done / Math.max(1, counting.total)} />
                <Text style={ui.muted}>
                  Önceden okunan bölümler sayılıyor… {counting.done}/{counting.total}
                </Text>
              </View>
            )}
            <Text style={ui.muted}>
              Bir bölüm %97’ye gelince bitmiş sayılır. İstatistikten önce okunan bölümler tahminidir: kaldığın bölümden öncekilerin
              hepsi okunmuş kabul edilir.
            </Text>
          </Card>
          {!rows.length && !counting && <Text style={ui.muted}>Henüz okuma kaydı yok.</Text>}
        </View>
      }
      renderItem={({ item }) => {
        const title = book.chapters[item.index]?.title ?? '';
        const done = isFinished(item);
        return (
          <Pressable
            onPress={() => router.push({ pathname: '/read/[id]/[index]', params: { id, index: String(item.index) } })}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
          >
            <View style={styles.rowTop}>
              <Text style={[ui.text, { flex: 1 }]} numberOfLines={1}>
                {item.index + 1}. {title.replace(/^(chapter|bölüm)\s*\d+\s*[:.\-–]?\s*/i, '')}
              </Text>
              <Text style={[ui.muted, done && { color: colors.accent }]}>{done ? '✓' : `%${Math.round(item.read * 100)}`}</Text>
            </View>
            <ProgressBar value={done ? 1 : item.read} />
            <Text style={ui.muted}>
              {formatCount(wordsRead(item))} / {formatCount(item.words)} kelime
            </Text>
          </Pressable>
        );
      }}
    />
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={ui.muted}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, backgroundColor: colors.bg, borderRadius: 10, padding: 12, gap: 2 },
  tileValue: { color: colors.text, fontSize: 22, fontWeight: '700' },
  row: { backgroundColor: colors.card, borderRadius: 10, padding: 12, gap: 6 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
