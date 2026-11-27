import { Image } from 'expo-image';
import { Link, Stack, router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ICONS } from '../components/icons';
import { Button, Card, IconButton, ui } from '../components/ui';
import { UpdateBanner } from '../components/UpdateCard';
import { ensureCovers, useCoverJob } from '../lib/coverArt';
import { useLibrary } from '../lib/library';
import { bookSize, coverFile, formatSize } from '../lib/storage';
import { colors } from '../lib/theme';
import type { Book } from '../lib/types';

function BookRow({ book }: { book: Book }) {
  const cover = coverFile(book);
  const coverJob = useCoverJob(book.id);
  const size = bookSize(book.id, `${book.updatedAt}:${book.downloaded.length}:${book.translated?.length ?? 0}`);
  return (
    <Link href={{ pathname: '/book/[id]', params: { id: book.id } }} asChild>
      <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}>
        {cover ? (
          <Image source={{ uri: cover.uri }} style={styles.cover} contentFit="cover" />
        ) : (
          <View style={[styles.cover, styles.coverEmpty]}>
            {coverJob?.running ? (
              <>
                <ActivityIndicator color={colors.accent} />
                <Text style={{ color: colors.muted, fontSize: 10, marginTop: 4, textAlign: 'center' }}>Kapak çiziliyor</Text>
              </>
            ) : (
              <Text style={{ color: colors.muted, fontSize: 22 }}>📖</Text>
            )}
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={2}>
            {book.title}
          </Text>
          {!!book.author && (
            <Text style={ui.muted} numberOfLines={1}>
              {book.author}
            </Text>
          )}
          <Text style={[ui.muted, { marginTop: 6 }]}>
            {book.downloaded.length} / {book.chapters.length} bölüm indirildi
            {book.translated?.length ? ` · ${book.translated.length} Türkçe` : ''}
          </Text>
          <Text style={ui.muted}>{formatSize(size)}</Text>
        </View>
      </Pressable>
    </Link>
  );
}

export default function Library() {
  const { books, loaded } = useLibrary();
  useEffect(() => {
    if (loaded) ensureCovers(books).catch(() => undefined);
  }, [books, loaded]);
  const insets = useSafeAreaInsets();
  return (
    <View style={ui.screen}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <IconButton icon={ICONS.words} label="Kelime defteri" onPress={() => router.push('/words')} />
              <IconButton icon={ICONS.settings} label="Ayarlar" onPress={() => router.push('/settings')} />
              <Button small title="+ Ekle" onPress={() => router.push('/add')} />
            </View>
          ),
        }}
      />
      <FlatList
        data={books}
        keyExtractor={(b) => b.id}
        renderItem={({ item }) => <BookRow book={item} />}
        ListHeaderComponent={<UpdateBanner />}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 16 + insets.bottom }}
        ListEmptyComponent={
          loaded ? (
            <Card style={{ gap: 10 }}>
              <Text style={ui.h2}>Kitaplığınız boş</Text>
              <Text style={ui.text}>
                Okuduğunuz romanın sayfasının bağlantısını kopyalayın (ör. novelfull.com/…html), “Roman ekle”ye
                yapıştırın. Bölümleri indirip uygulamanın içinde okuyabilir, Türkçeye çevirebilir ve dinleyebilirsiniz.
              </Text>
              <Button title="Roman ekle" onPress={() => router.push('/add')} />
            </Card>
          ) : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 12,
    padding: 10,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cover: { width: 60, height: 86, borderRadius: 6, backgroundColor: colors.border },
  coverEmpty: { alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
});
