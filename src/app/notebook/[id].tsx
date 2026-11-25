import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, ProgressBar, ui } from '../../components/ui';
import type { GlossaryEntry } from '../../lib/gemini';
import { useBook } from '../../lib/library';
import { editNotebook, fillNotebook, missingChapters, stopNotebookJob, useNotebook, useNotebookJob } from '../../lib/notebook';
import { normName, type NotebookCharacter } from '../../lib/notebookCore';
import { useSettings } from '../../lib/settings';
import { loadGlossary, saveGlossary } from '../../lib/storage';
import { colors } from '../../lib/theme';

type Tab = 'characters' | 'summaries' | 'glossary';

export default function NotebookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const book = useBook(id);
  const nb = useNotebook(id);
  const job = useNotebookJob(id);
  const settings = useSettings();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('characters');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [glossary, setGlossary] = useState<GlossaryEntry[] | null>(null);
  const [editing, setEditing] = useState<{ index: number; source: string; target: string } | null>(null);

  useEffect(() => {
    let alive = true;
    loadGlossary(id).then((g) => alive && setGlossary(g));
    return () => {
      alive = false;
    };
  }, [id, job?.running]);

  // Never show what lies beyond the reading point.
  const upTo = book?.progress?.index ?? (book?.downloaded.length ? Math.max(...book.downloaded) : -1);
  const missing = useMemo(() => (nb && book ? missingChapters(id, nb, upTo) : []), [nb, book, id, upTo]);
  const q = normName(query);

  const characters = useMemo(() => {
    const list = (nb?.characters ?? []).filter((c) => c.firstChapter <= upTo);
    const filtered = q
      ? list.filter((c) => normName(c.name).includes(q) || c.aliases.some((a) => normName(a).includes(q)) || c.notes.some((n) => normName(n.text).includes(q)))
      : list;
    return filtered.sort((a, b) => b.seenIn.length - a.seenIn.length || a.firstChapter - b.firstChapter);
  }, [nb, q, upTo]);

  const summaries = useMemo(() => {
    const entries = Object.entries(nb?.summaries ?? {})
      .map(([k, v]) => ({ index: Number(k), text: v }))
      .filter((e) => e.index <= upTo && e.text !== '—')
      .sort((a, b) => a.index - b.index);
    return q ? entries.filter((e) => normName(e.text).includes(q) || String(e.index + 1) === query.trim()) : entries;
  }, [nb, q, query, upTo]);

  const terms = useMemo(() => {
    const list = (glossary ?? []).map((g, index) => ({ ...g, index }));
    return q ? list.filter((g) => normName(g.source).includes(q) || normName(g.target).includes(q)) : list;
  }, [glossary, q]);

  if (!book) {
    return (
      <View style={[ui.screen, { padding: 16 }]}>
        <Text style={ui.text}>Kitap bulunamadı.</Text>
      </View>
    );
  }

  const fill = () => {
    if (!settings.hasGeminiKey) {
      Alert.alert('Gemini anahtarı gerekli', 'Defteri doldurmak için Ayarlar’dan Gemini anahtarınızı girin.', [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Ayarlara git', onPress: () => router.push('/settings') },
      ]);
      return;
    }
    fillNotebook(id, upTo).catch(() => undefined);
  };

  const saveTerm = async () => {
    if (!editing || !glossary) return;
    const next = [...glossary];
    const entry = { source: editing.source.trim(), target: editing.target.trim() };
    if (!entry.source || !entry.target) return;
    if (editing.index >= 0) next[editing.index] = entry;
    else next.push(entry);
    setGlossary(next);
    setEditing(null);
    await saveGlossary(id, next);
  };

  const deleteTerm = (index: number) =>
    Alert.alert('Terim silinsin mi?', glossary?.[index]?.source ?? '', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          const next = (glossary ?? []).filter((_, k) => k !== index);
          setGlossary(next);
          await saveGlossary(id, next);
        },
      },
    ]);

  const deleteCharacter = (c: NotebookCharacter) =>
    Alert.alert(`${c.name} defterden silinsin mi?`, 'Yanlış ya da gereksiz bir kayıtsa silebilirsiniz.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () => editNotebook(id, (n) => ({ ...n, characters: n.characters.filter((x) => x.name !== c.name) })),
      },
    ]);

  const header = (
    <View style={{ gap: 12, marginBottom: 12 }}>
      <Card style={{ gap: 8 }}>
        {job?.running ? (
          <>
            <ProgressBar value={job.total ? job.done / job.total : 0} />
            <Text style={ui.muted}>
              {job.message} · {job.done}/{job.total}
            </Text>
            <Button small variant="secondary" title="Durdur" onPress={() => stopNotebookJob(id)} />
          </>
        ) : (
          <>
            <Text style={ui.text}>
              {missing.length
                ? `Okuduğun yere kadar (${upTo + 1}. bölüm) ${missing.length} bölüm henüz deftere işlenmedi.`
                : `Defter ${upTo + 1}. bölüme kadar güncel.`}
            </Text>
            <Text style={ui.muted}>
              Yeni çevrilen bölümler deftere kendiliğinden eklenir. Okuduğun yerden ilerisi gösterilmez.
            </Text>
            {missing.length > 0 && <Button title={`Güncelle (${missing.length} bölüm)`} onPress={fill} />}
            {!!job?.error && <Text style={ui.error}>{job.error}</Text>}
            {!!job?.message && !job.error && <Text style={ui.muted}>{job.message}</Text>}
          </>
        )}
      </Card>
      <View style={styles.tabs}>
        {(
          [
            ['characters', `Karakterler · ${characters.length}`],
            ['summaries', `Özetler · ${summaries.length}`],
            ['glossary', `Sözlük · ${glossary?.length ?? 0}`],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <Pressable
            key={t}
            onPress={() => {
              setTab(t);
              setOpen(null);
            }}
            style={[styles.tab, tab === t && { backgroundColor: colors.accent, borderColor: colors.accent }]}
          >
            <Text style={{ color: tab === t ? colors.accentText : colors.text, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Ara…"
        placeholderTextColor={colors.muted}
        style={ui.input}
      />
      {tab === 'glossary' && (
        <Button small variant="secondary" title="+ Terim ekle" onPress={() => setEditing({ index: -1, source: '', target: '' })} />
      )}
    </View>
  );

  const empty = (text: string) => <Text style={[ui.muted, { textAlign: 'center', marginTop: 24 }]}>{text}</Text>;

  return (
    <View style={ui.screen}>
      <Stack.Screen options={{ title: 'Hikâye defteri' }} />
      {tab === 'characters' && (
        <FlatList
          data={characters}
          keyExtractor={(c) => c.name}
          ListHeaderComponent={header}
          ListEmptyComponent={empty(nb ? 'Henüz karakter yok. “Güncelle” ile okuduğun bölümleri deftere işleyebilirsin.' : 'Yükleniyor…')}
          contentContainerStyle={{ padding: 16, paddingBottom: 16 + insets.bottom }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: c }) => {
            const expanded = open === c.name;
            const notes = c.notes.filter((n) => n.chapter <= upTo);
            return (
              <Pressable onPress={() => setOpen(expanded ? null : c.name)} onLongPress={() => deleteCharacter(c)} style={styles.item}>
                <View style={[ui.row, { justifyContent: 'space-between' }]}>
                  <Text style={styles.name}>{c.name}</Text>
                  <Text style={{ color: colors.muted }}>{expanded ? '▴' : '▾'}</Text>
                </View>
                {!!c.aliases.length && <Text style={ui.muted}>Diğer adları: {c.aliases.join(', ')}</Text>}
                <Text style={ui.muted}>
                  {c.firstChapter + 1}. bölümde tanıtıldı · {c.seenIn.filter((x) => x <= upTo).length} bölümde geçiyor
                </Text>
                {!expanded && !!notes.length && (
                  <Text style={ui.text} numberOfLines={2}>
                    {notes[0].text}
                  </Text>
                )}
                {expanded &&
                  notes.map((n, k) => (
                    <Text key={k} style={ui.text}>
                      <Text style={{ color: colors.accent }}>{n.chapter + 1}. </Text>
                      {n.text}
                    </Text>
                  ))}
              </Pressable>
            );
          }}
        />
      )}
      {tab === 'summaries' && (
        <FlatList
          data={summaries}
          keyExtractor={(s) => String(s.index)}
          ListHeaderComponent={header}
          ListEmptyComponent={empty('Henüz özet yok.')}
          contentContainerStyle={{ padding: 16, paddingBottom: 16 + insets.bottom }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: s }) => {
            const key = `s${s.index}`;
            const expanded = open === key;
            return (
              <Pressable onPress={() => setOpen(expanded ? null : key)} style={styles.item}>
                <View style={[ui.row, { justifyContent: 'space-between' }]}>
                  <Text style={styles.name} numberOfLines={1}>
                    {s.index + 1}. {book.chapters[s.index]?.title ?? ''}
                  </Text>
                  <Text style={{ color: colors.muted }}>{expanded ? '▴' : '▾'}</Text>
                </View>
                <Text style={ui.text} numberOfLines={expanded ? undefined : 2}>
                  {s.text}
                </Text>
                {expanded && (
                  <Button
                    small
                    variant="secondary"
                    title="Bu bölümü aç"
                    onPress={() => router.push({ pathname: '/read/[id]/[index]', params: { id, index: String(s.index) } })}
                  />
                )}
              </Pressable>
            );
          }}
        />
      )}
      {tab === 'glossary' && (
        <FlatList
          data={terms}
          keyExtractor={(g) => `${g.index}:${g.source}`}
          ListHeaderComponent={header}
          ListEmptyComponent={empty('Sözlük boş. Çeviri yapıldıkça özel terimler buraya eklenir.')}
          contentContainerStyle={{ padding: 16, paddingBottom: 16 + insets.bottom }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item: g }) => (
            <Pressable
              onPress={() => setEditing({ index: g.index, source: g.source, target: g.target })}
              onLongPress={() => deleteTerm(g.index)}
              style={[styles.item, { flexDirection: 'row', gap: 8, alignItems: 'center' }]}
            >
              <Text style={[ui.text, { flex: 1 }]}>{g.source}</Text>
              <Text style={{ color: colors.muted }}>→</Text>
              <Text style={[ui.text, { flex: 1, color: colors.accent }]}>{g.target}</Text>
            </Pressable>
          )}
        />
      )}

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <Pressable style={styles.backdrop} onPress={() => setEditing(null)}>
          <Pressable style={styles.dialog}>
            <Text style={ui.h2}>{editing && editing.index >= 0 ? 'Terimi düzenle' : 'Yeni terim'}</Text>
            <Text style={ui.muted}>Orijinal</Text>
            <TextInput
              value={editing?.source ?? ''}
              onChangeText={(t) => setEditing((e) => (e ? { ...e, source: t } : e))}
              style={ui.input}
            />
            <Text style={ui.muted}>Türkçesi (çeviride hep bu kullanılır)</Text>
            <TextInput
              value={editing?.target ?? ''}
              onChangeText={(t) => setEditing((e) => (e ? { ...e, target: t } : e))}
              style={ui.input}
            />
            <View style={ui.row}>
              {editing && editing.index >= 0 && (
                <Button
                  variant="danger"
                  title="Sil"
                  onPress={() => {
                    const k = editing.index;
                    setEditing(null);
                    deleteTerm(k);
                  }}
                />
              )}
              <Button variant="secondary" title="Vazgeç" onPress={() => setEditing(null)} style={{ flex: 1 }} />
              <Button title="Kaydet" onPress={saveTerm} style={{ flex: 1 }} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 6 },
  tab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  item: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 12,
    gap: 4,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  name: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: colors.card, borderRadius: 14, padding: 16, gap: 8 },
});
