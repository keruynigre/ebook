import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChapterSheet } from '../../components/ChapterSheet';
import { Button, Card, ProgressBar, ui } from '../../components/ui';
import { cancelDownload, startDownload, useDownload } from '../../lib/downloads';
import { refreshChapterList, removeBook, useBook } from '../../lib/library';
import { useSettings } from '../../lib/settings';
import { bookSize, coverFile, formatSize } from '../../lib/storage';
import { colors } from '../../lib/theme';

export default function BookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const book = useBook(id);
  const download = useDownload(id);
  const insets = useSafeAreaInsets();

  const total = book?.chapters.length ?? 0;
  const [refreshing, setRefreshing] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [showChapters, setShowChapters] = useState(false);
  const selecting = selected.size > 0;

  const toggle = useCallback((i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  const downloaded = useMemo(() => new Set(book?.downloaded ?? []), [book?.downloaded]);
  const settings = useSettings();

  const openChapter = useCallback(
    (index: number) => {
      setShowChapters(false);
      router.push({ pathname: '/read/[id]/[index]', params: { id, index: String(index) } });
    },
    [id],
  );

  if (!book) {
    return (
      <View style={[ui.screen, { padding: 16 }]}>
        <Text style={ui.text}>Kitap bulunamadı.</Text>
      </View>
    );
  }

  const missingAll = () => {
    const have = new Set(book.downloaded);
    return book.chapters.map((_, i) => i).filter((i) => !have.has(i));
  };

  const needsKey = () => {
    if (settings.hasGeminiKey && settings.geminiModel) return false;
    Alert.alert('Gemini anahtarı gerekli', 'Çeviri için önce Ayarlar’dan Gemini API anahtarınızı girin.', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Ayarlara git', onPress: () => router.push('/settings') },
    ]);
    return true;
  };

  // Translate every untranslated chapter from the reading point to the end; stops by itself when the quota runs out.
  const onTranslate = () => {
    if (needsKey()) return;
    const from = book.progress?.index ?? 0;
    const done = new Set(book.translated ?? []);
    const indexes = book.chapters.map((_, i) => i).filter((i) => i >= from && !done.has(i));
    if (!indexes.length) {
      Alert.alert('Çevrilecek bölüm yok', 'Okuduğun yerden sonraki bütün bölümler zaten Türkçe.');
      return;
    }
    startDownload(book.id, indexes, { translate: true }).catch((e) => Alert.alert('Çeviri hatası', (e as Error).message));
  };

  const runSelected = (translate: boolean) => {
    if (translate && needsKey()) return;
    const indexes = [...selected].sort((a, b) => a - b);
    setSelected(new Set());
    startDownload(book.id, indexes, { translate }).catch((e) => Alert.alert('Hata', (e as Error).message));
  };

  const onDownload = () => {
    const indexes = missingAll();
    if (indexes.length) startDownload(book.id, indexes).catch((e) => Alert.alert('İndirme hatası', (e as Error).message));
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
  const size = bookSize(book.id, `${book.updatedAt}:${book.downloaded.length}:${book.translated?.length ?? 0}`);
  const running = !!download?.running;
  const saved = book.progress && downloaded.has(book.progress.index) ? book.progress.index : null;
  const readIndex = saved ?? (book.downloaded.length ? Math.min(...book.downloaded) : null);

  const header = (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', gap: 14 }}>
        {cover && <Image source={{ uri: cover.uri }} style={styles.cover} contentFit="cover" />}
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={ui.h1}>{book.title}</Text>
          {!!book.author && <Text style={ui.muted}>{book.author}</Text>}
          <Text style={[ui.text, { marginTop: 4 }]}>
            {book.downloaded.length} / {total} bölüm indirildi
          </Text>
          {!!book.translated?.length && <Text style={ui.muted}>{book.translated.length} bölüm Türkçe</Text>}
          <Text style={ui.muted}>Telefonda {formatSize(size)} yer kaplıyor</Text>
        </View>
      </View>
      {!!book.description && (
        <Pressable onPress={() => setShowAbout((v) => !v)} hitSlop={6}>
          <Text style={ui.muted} numberOfLines={showAbout ? undefined : 5}>
            {book.description}
          </Text>
          {book.description.length > 220 && (
            <Text style={[ui.muted, { color: colors.accent, marginTop: 2 }]}>{showAbout ? 'Daha az göster ▴' : 'Devamını göster ▾'}</Text>
          )}
        </Pressable>
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
      <View style={ui.row}>
        <Button title={`📑 Bölümler · ${total}`} variant="secondary" onPress={() => setShowChapters(true)} style={{ flex: 1 }} />
        <Button
          title="📓 Hikâye defteri"
          variant="secondary"
          onPress={() => router.push({ pathname: '/notebook/[id]', params: { id: book.id } })}
          style={{ flex: 1 }}
        />
      </View>
      <View style={ui.row}>
        <Button
          title="🔍 Kitapta ara"
          variant="secondary"
          onPress={() => router.push({ pathname: '/search/[id]', params: { id: book.id } })}
          style={{ flex: 1 }}
        />
        <Button
          title="📊 İstatistik"
          variant="secondary"
          onPress={() => router.push({ pathname: '/stats/[id]', params: { id: book.id } })}
          style={{ flex: 1 }}
        />
      </View>
      <Button title="📒 Kelime defteri" variant="secondary" onPress={() => router.push('/words')} />

      <Card style={{ gap: 10 }}>
        <Text style={ui.h2}>İndirme ve çeviri</Text>
        <Text style={ui.text}>
          {book.downloaded.length === total
            ? `Bütün bölümler indirildi (${total}).`
            : `${book.downloaded.length} / ${total} bölüm indirildi · ${total - book.downloaded.length} eksik`}
        </Text>
        <View style={ui.row}>
          <Button
            title={book.downloaded.length === total ? 'Hepsi indirildi ✓' : 'Tümünü indir'}
            onPress={onDownload}
            disabled={running || book.downloaded.length === total}
            style={{ flex: 1 }}
          />
          <Button title="Türkçeye çevir" variant="secondary" onPress={onTranslate} disabled={running} style={{ flex: 1 }} />
        </View>
        <Text style={ui.muted}>
          “Türkçeye çevir” okuduğun bölümden itibaren çevrilmemiş bölümleri sırayla çevirir; Gemini’nin günlük hakkı bitince
          durur, ertesi gün yeniden basınca kaldığı yerden sürer. Belirli bölümler için Bölümler penceresinde uzun basıp seçin.
        </Text>
        {settings.autoTranslate && settings.hasGeminiKey && (
          <Text style={ui.muted}>Otomatik çeviri açık: “İndir” bölümleri Türkçeye de çevirir.</Text>
        )}

        {download && (running || download.error || download.finishedAt) && (
          <View style={{ gap: 6, marginTop: 4 }}>
            {download.total > 0 && <ProgressBar value={(download.done + download.failed) / download.total} />}
            <Text style={ui.muted}>
              {running
                ? `${download.phase ?? 'İndiriliyor'} ${download.done + download.failed + 1}/${download.total}: ${download.current ?? ''}`
                : download.total === 0
                  ? 'Bu aralıktaki bölümler zaten hazır.'
                  : `Bitti: ${download.done} bölüm hazır${download.translated ? `, ${download.translated} bölüm çevrildi` : ''}${download.failed ? `, ${download.failed} bölüm alınamadı` : ''}.`}
            </Text>
            {!!download.translateError && <Text style={ui.error}>Çeviri: {download.translateError}</Text>}
            {!!download.error && !running && <Text style={ui.error}>{download.error}</Text>}
            {running && <Button small variant="secondary" title="Durdur" onPress={() => cancelDownload(book.id)} />}
          </View>
        )}
      </Card>

      {!!message && <Text style={ui.muted}>{message}</Text>}
      <View style={ui.row}>
        <Button small variant="secondary" title="Bölüm listesini güncelle" onPress={refresh} busy={refreshing} disabled={running} style={{ flex: 1 }} />
        <Button small variant="danger" title="Sil" onPress={remove} disabled={running} />
      </View>
    </View>
  );

  return (
    <View style={ui.screen}>
      <Stack.Screen options={{ title: book.title }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 + insets.bottom }} keyboardShouldPersistTaps="handled">
        {header}
      </ScrollView>
      <ChapterSheet
        visible={showChapters}
        book={book}
        onClose={() => {
          setShowChapters(false);
          setSelected(new Set());
        }}
        onOpen={openChapter}
        selected={selected}
        onToggle={toggle}
        footer={
          selecting ? (
            <View style={styles.selectBar}>
              <View style={[ui.row, { justifyContent: 'space-between' }]}>
                <Text style={ui.text}>{selected.size} bölüm seçildi</Text>
                <Pressable onPress={() => setSelected(new Set())} hitSlop={10}>
                  <Text style={{ color: colors.muted, fontWeight: '600' }}>Seçimi kaldır</Text>
                </Pressable>
              </View>
              <View style={ui.row}>
                <Button title="Türkçeye çevir" onPress={() => runSelected(true)} disabled={running} style={{ flex: 1 }} />
                <Button title="İndir" variant="secondary" onPress={() => runSelected(false)} disabled={running} style={{ flex: 1 }} />
              </View>
              {running && <Text style={ui.muted}>Önceki işlem bitince seçilenleri başlatabilirsiniz.</Text>}
            </View>
          ) : (
            <Text style={[ui.muted, { padding: 12 }]}>
              İndirilen bölüme dokunarak okuyun; uzun basarak seçin, seçtiklerinizi çevirin ya da indirin.
            </Text>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { width: 96, height: 138, borderRadius: 8, backgroundColor: colors.border },
  selectBar: {
    gap: 10,
    padding: 12,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderColor: colors.accent,
  },
  trBadge: { color: colors.accent, fontSize: 11, fontWeight: '800', borderWidth: 1, borderColor: colors.accent, borderRadius: 4, paddingHorizontal: 4 },
});
