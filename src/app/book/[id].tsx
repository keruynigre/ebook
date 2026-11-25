import { Image } from 'expo-image';
import type { File } from 'expo-file-system';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { memo, useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, ProgressBar, ui } from '../../components/ui';
import { cancelDownload, startDownload, useDownload } from '../../lib/downloads';
import { exportEpub, saveToFolder } from '../../lib/exportEpub';
import { refreshChapterList, removeBook, useBook } from '../../lib/library';
import { coverFile } from '../../lib/storage';
import { colors } from '../../lib/theme';
import type { Book, ChapterRef } from '../../lib/types';

const ChapterRow = memo(function ChapterRow({
  index,
  chapter,
  downloaded,
  onOpen,
}: {
  index: number;
  chapter: ChapterRef;
  downloaded: boolean;
  onOpen: (i: number) => void;
}) {
  return (
    <Pressable
      onPress={() => downloaded && onOpen(index)}
      style={({ pressed }) => [styles.chapter, pressed && downloaded && { opacity: 0.7 }]}
    >
      <Text style={[styles.chapterMark, { color: downloaded ? colors.success : colors.border }]}>
        {downloaded ? '●' : '○'}
      </Text>
      <Text style={[ui.text, { flex: 1, color: downloaded ? colors.text : colors.muted }]} numberOfLines={1}>
        {chapter.title}
      </Text>
    </Pressable>
  );
});

function formatSize(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function firstMissing(book: Book): number {
  const have = new Set(book.downloaded);
  for (let i = 0; i < book.chapters.length; i++) if (!have.has(i)) return i;
  return book.chapters.length;
}

export default function BookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const book = useBook(id);
  const download = useDownload(id);
  const insets = useSafeAreaInsets();

  const total = book?.chapters.length ?? 0;
  const start = book ? Math.min(firstMissing(book), Math.max(0, total - 1)) : 0;
  const [fromText, setFromText] = useState(String(start + 1));
  const [toText, setToText] = useState(String(Math.min(start + 10, total)));
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<{ file: File; count: number; missing: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');

  const downloaded = useMemo(() => new Set(book?.downloaded ?? []), [book?.downloaded]);

  const openChapter = useCallback(
    (index: number) => router.push({ pathname: '/read/[id]/[index]', params: { id, index: String(index) } }),
    [id],
  );

  if (!book) {
    return (
      <View style={[ui.screen, { padding: 16 }]}>
        <Text style={ui.text}>Kitap bulunamadı.</Text>
      </View>
    );
  }

  const parseRange = (): [number, number] | null => {
    const f = parseInt(fromText, 10);
    const t = parseInt(toText, 10);
    if (!Number.isFinite(f) || !Number.isFinite(t) || f < 1 || t < f || t > total) {
      Alert.alert('Aralık hatalı', `1 ile ${total} arasında bir aralık girin.`);
      return null;
    }
    return [f - 1, t - 1];
  };

  const setRange = (from: number, count: number | 'all') => {
    const f = Math.min(from, total - 1);
    setFromText(String(f + 1));
    setToText(String(count === 'all' ? total : Math.min(f + count, total)));
  };

  const doDownload = (from: number, to: number) => {
    const indexes = Array.from({ length: to - from + 1 }, (_, k) => from + k);
    setExported(null);
    startDownload(book.id, indexes).catch((e) => Alert.alert('İndirme hatası', (e as Error).message));
  };

  const onDownload = () => {
    const r = parseRange();
    if (r) doDownload(r[0], r[1]);
  };

  const onExport = async () => {
    const r = parseRange();
    if (!r) return;
    const [from, to] = r;
    let missing = 0;
    for (let i = from; i <= to; i++) if (!downloaded.has(i)) missing++;
    const run = async () => {
      setExporting(true);
      setExported(null);
      try {
        const res = await exportEpub(book, from, to);
        setExported({ file: res.file, count: res.chapterCount, missing: res.missing });
      } catch (e) {
        Alert.alert('EPUB oluşturulamadı', (e as Error).message);
      } finally {
        setExporting(false);
      }
    };
    if (missing === 0) return run();
    if (missing === to - from + 1) {
      Alert.alert('Bölümler indirilmemiş', 'Bu aralıktaki bölümler henüz indirilmedi. Şimdi indirilsin mi?', [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'İndir', onPress: () => doDownload(from, to) },
      ]);
      return;
    }
    Alert.alert('Eksik bölümler var', `Bu aralıkta ${missing} bölüm henüz indirilmedi.`, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Olanlarla oluştur', onPress: run },
      { text: 'Önce indir', onPress: () => doDownload(from, to) },
    ]);
  };

  const share = async () => {
    if (!exported) return;
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert('Paylaşım kullanılamıyor');
      return;
    }
    await Sharing.shareAsync(exported.file.uri, {
      mimeType: 'application/epub+zip',
      dialogTitle: 'EPUB’u gönder',
    });
  };

  const open = async () => {
    if (!exported) return;
    try {
      await exported.file.preview();
    } catch {
      Alert.alert('Açılamadı', 'EPUB açabilen bir uygulama bulunamadı. “Paylaş” ile okuma uygulamanızı seçebilirsiniz.');
    }
  };

  const save = async () => {
    if (!exported) return;
    try {
      const where = await saveToFolder(exported.file);
      setMessage(`Kaydedildi: ${where}`);
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (!/cancel/i.test(msg)) Alert.alert('Kaydedilemedi', msg);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    setMessage('');
    try {
      const before = book.chapters.length;
      const updated = await refreshChapterList(book, (p) => setMessage(p.message));
      const diff = updated.chapters.length - before;
      setMessage(diff > 0 ? `${diff} yeni bölüm eklendi.` : 'Yeni bölüm yok.');
    } catch (e) {
      setMessage('');
      Alert.alert('Liste güncellenemedi', (e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const remove = () =>
    Alert.alert('Kitap silinsin mi?', `“${book.title}” ve indirilen bütün bölümleri telefondan silinecek.`, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          cancelDownload(book.id);
          await removeBook(book.id);
          router.back();
        },
      },
    ]);

  const cover = coverFile(book);
  const running = !!download?.running;
  const next = firstMissing(book);
  const saved = book.progress && downloaded.has(book.progress.index) ? book.progress.index : null;
  const readIndex = saved ?? (book.downloaded.length ? Math.min(...book.downloaded) : null);

  const header = (
    <View style={{ gap: 14, marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', gap: 14 }}>
        {cover && <Image source={{ uri: cover.uri }} style={styles.cover} contentFit="cover" />}
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={ui.h1}>{book.title}</Text>
          {!!book.author && <Text style={ui.muted}>{book.author}</Text>}
          <Text style={[ui.text, { marginTop: 4 }]}>
            {book.downloaded.length} / {total} bölüm indirildi
          </Text>
        </View>
      </View>
      {!!book.description && (
        <Text style={ui.muted} numberOfLines={5}>
          {book.description}
        </Text>
      )}

      <Button
        title={
          readIndex === null
            ? 'Okumak için önce bölüm indirin'
            : saved !== null
              ? `Okumaya devam et · ${saved + 1}. bölüm`
              : `Okumaya başla · ${readIndex + 1}. bölüm`
        }
        onPress={() => readIndex !== null && openChapter(readIndex)}
        disabled={readIndex === null}
      />

      <Card style={{ gap: 10 }}>
        <Text style={ui.h2}>Bölüm aralığı</Text>
        <View style={ui.row}>
          <TextInput
            value={fromText}
            onChangeText={setFromText}
            keyboardType="number-pad"
            style={[ui.input, { flex: 1, textAlign: 'center' }]}
          />
          <Text style={ui.text}>–</Text>
          <TextInput
            value={toText}
            onChangeText={setToText}
            keyboardType="number-pad"
            style={[ui.input, { flex: 1, textAlign: 'center' }]}
          />
          <Text style={ui.muted}>/ {total}</Text>
        </View>
        <View style={[ui.row, { flexWrap: 'wrap' }]}>
          <Button small variant="secondary" title="Sonraki 10" onPress={() => setRange(next, 10)} />
          <Button small variant="secondary" title="Sonraki 50" onPress={() => setRange(next, 50)} />
          <Button small variant="secondary" title="Tümü" onPress={() => setRange(0, 'all')} />
        </View>
        <View style={ui.row}>
          <Button title="İndir" onPress={onDownload} disabled={running} style={{ flex: 1 }} />
          <Button title="EPUB oluştur" variant="secondary" onPress={onExport} busy={exporting} disabled={running} style={{ flex: 1 }} />
        </View>

        {download && (running || download.error || download.finishedAt) && (
          <View style={{ gap: 6, marginTop: 4 }}>
            {download.total > 0 && <ProgressBar value={(download.done + download.failed) / download.total} />}
            <Text style={ui.muted}>
              {running
                ? `İndiriliyor ${download.done + download.failed + 1}/${download.total}: ${download.current ?? ''}`
                : download.total === 0
                  ? 'Bu aralıktaki bölümler zaten indirilmiş.'
                  : `Bitti: ${download.done} bölüm indirildi${download.failed ? `, ${download.failed} bölüm alınamadı` : ''}.`}
            </Text>
            {!!download.error && !running && <Text style={ui.error}>{download.error}</Text>}
            {running && <Button small variant="secondary" title="Durdur" onPress={() => cancelDownload(book.id)} />}
          </View>
        )}
      </Card>

      {exported && (
        <Card style={{ gap: 10, borderColor: colors.accent }}>
          <Text style={ui.h2}>EPUB hazır</Text>
          <Text style={ui.text}>{exported.file.name}</Text>
          <Text style={ui.muted}>
            {exported.count} bölüm · {formatSize(exported.file.size ?? 0)}
            {exported.missing ? ` · ${exported.missing} eksik bölüm atlandı` : ''}
          </Text>
          <View style={ui.row}>
            <Button title="Paylaş" onPress={share} style={{ flex: 1 }} />
            <Button title="Başka uygulamada aç" variant="secondary" onPress={open} style={{ flex: 1 }} />
          </View>
          <Button title="Klasöre kaydet" variant="secondary" onPress={save} />
        </Card>
      )}

      {!!message && <Text style={ui.muted}>{message}</Text>}
      <View style={ui.row}>
        <Button small variant="secondary" title="Bölüm listesini güncelle" onPress={refresh} busy={refreshing} disabled={running} style={{ flex: 1 }} />
        <Button small variant="danger" title="Sil" onPress={remove} disabled={running} />
      </View>
      <Text style={[ui.h2, { marginTop: 8, marginBottom: 0 }]}>Bölümler</Text>
      <Text style={ui.muted}>İndirilen bölümlere dokunarak okuyabilirsiniz.</Text>
    </View>
  );

  return (
    <View style={ui.screen}>
      <Stack.Screen options={{ title: book.title }} />
      <FlatList
        data={book.chapters}
        keyExtractor={(c, i) => `${i}:${c.url}`}
        renderItem={({ item, index }) => (
          <ChapterRow index={index} chapter={item} downloaded={downloaded.has(index)} onOpen={openChapter} />
        )}
        ListHeaderComponent={header}
        contentContainerStyle={{ padding: 16, paddingBottom: 16 + insets.bottom }}
        initialNumToRender={30}
        windowSize={10}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { width: 96, height: 138, borderRadius: 8, backgroundColor: colors.border },
  chapter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chapterMark: { fontSize: 12, width: 14, textAlign: 'center' },
});
