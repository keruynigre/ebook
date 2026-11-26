import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, ProgressBar, ui } from '../../components/ui';
import { getBook, useBook } from '../../lib/library';
import { searchParagraphs, type SearchHit } from '../../lib/searchCore';
import { setSettings } from '../../lib/settings';
import { loadChapter, loadTranslation } from '../../lib/storage';
import { colors } from '../../lib/theme';

type Where = 'tr' | 'orig' | 'both';
interface Row extends SearchHit {
  chapter: number;
  lang: 'tr' | 'orig';
}

const MAX_RESULTS = 500;

/** Search every downloaded chapter of a book for a word or phrase. */
export default function SearchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const book = useBook(id);
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [where, setWhere] = useState<Where>(book?.translated?.length ? 'tr' : 'orig');
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [searched, setSearched] = useState('');
  const run = useRef(0);

  useEffect(
    () => () => {
      run.current++;
    },
    [],
  );

  const search = async () => {
    const b = getBook(id);
    const q = query.trim();
    if (!b || q.length < 2) return;
    const my = ++run.current;
    const origLang: 'tr' | 'en' = b.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en';
    const chapters = [...b.downloaded].sort((x, y) => x - y);
    const found: Row[] = [];
    setRows([]);
    setSearched(q);
    setProgress({ done: 0, total: chapters.length });
    for (let k = 0; k < chapters.length && found.length < MAX_RESULTS; k++) {
      if (run.current !== my) return;
      const c = chapters[k];
      if (where !== 'orig' && b.translated?.includes(c)) {
        const t = await loadTranslation(id, c).catch(() => null);
        for (const h of t ? searchParagraphs(t.paragraphs, q, 'tr') : []) found.push({ ...h, chapter: c, lang: 'tr' });
      }
      if (where !== 'tr') {
        const o = await loadChapter(id, c).catch(() => null);
        for (const h of o ? searchParagraphs(o.paragraphs, q, origLang) : []) found.push({ ...h, chapter: c, lang: 'orig' });
      }
      if (k % 20 === 19 || k === chapters.length - 1) {
        if (run.current !== my) return;
        setRows([...found]);
        setProgress({ done: k + 1, total: chapters.length });
      }
    }
    if (run.current !== my) return;
    setRows([...found]);
    setProgress(null);
  };

  const open = (r: Row) => {
    setSettings({ showTranslation: r.lang === 'tr' });
    router.push({ pathname: '/read/[id]/[index]', params: { id, index: String(r.chapter), para: String(r.para) } });
  };

  return (
    <View style={{ flex: 1, padding: 16, gap: 10, paddingBottom: insets.bottom }}>
      <Text style={ui.muted} numberOfLines={1}>
        {book?.title ?? ''} · {book?.downloaded.length ?? 0} indirilmiş bölümde arar
      </Text>
      <View style={ui.row}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Ad, kelime ya da söz (örn. Tie Zhu)"
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={search}
          style={[ui.input, { flex: 1 }]}
        />
        <Button title="Ara" onPress={search} disabled={query.trim().length < 2} />
      </View>
      <View style={ui.row}>
        {(
          [
            ['tr', 'Türkçe'],
            ['orig', 'Orijinal'],
            ['both', 'İkisi'],
          ] as [Where, string][]
        ).map(([w, label]) => (
          <Button key={w} small title={label} variant={where === w ? 'primary' : 'secondary'} onPress={() => setWhere(w)} style={{ flex: 1 }} />
        ))}
      </View>
      {progress && (
        <View style={{ gap: 4 }}>
          <ProgressBar value={progress.done / Math.max(1, progress.total)} />
          <Text style={ui.muted}>
            Aranıyor {progress.done}/{progress.total} bölüm · {rows.length} sonuç
          </Text>
        </View>
      )}
      {!progress && !!searched && (
        <Text style={ui.muted}>
          “{searched}” {rows.length ? `${rows.length >= MAX_RESULTS ? `ilk ${MAX_RESULTS}` : rows.length} yerde geçiyor.` : 'bulunamadı.'}
        </Text>
      )}
      <FlatList
        data={rows}
        keyExtractor={(r) => `${r.chapter}-${r.lang}-${r.para}`}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 8, paddingBottom: 24 }}
        renderItem={({ item: r }) => (
          <Pressable onPress={() => open(r)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
            <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 13 }}>
              {r.chapter + 1}. bölüm · {r.lang === 'tr' ? 'Türkçe' : 'Orijinal'}
            </Text>
            <Text style={{ color: colors.text, fontSize: 15, lineHeight: 21 }}>
              {r.snippet.slice(0, r.start)}
              <Text style={{ backgroundColor: colors.accent + '55', fontWeight: '700' }}>{r.snippet.slice(r.start, r.start + r.length)}</Text>
              {r.snippet.slice(r.start + r.length)}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: colors.card, borderRadius: 12, padding: 12, gap: 4 },
});
