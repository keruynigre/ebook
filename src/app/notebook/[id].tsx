import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, ProgressBar, ui } from '../../components/ui';
import type { GlossaryEntry } from '../../lib/gemini';
import { useBook } from '../../lib/library';
import { editNotebook, fillNotebook, joinSameCharacters, missingChapters, rebuildNotebook, resetNotebook, refreshProfiles, stopNotebookJob, useNotebook, useNotebookJob } from '../../lib/notebook';
import { aliasesFor, displayName, MAX_NOTES_SHOWN, mergeCharacterGroups, normName, renameCharacter, noteText, profileFor, splitCast, type NotebookCharacter } from '../../lib/notebookCore';
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
  // Same language as the reader: Turkish when reading the translation, English for the original.
  const lang: 'tr' | 'en' = settings.showTranslation ? 'tr' : 'en';
  const [tab, setTab] = useState<Tab>('characters');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  // Character whose chapter-by-chapter notes are shown under the short card.
  const [showAll, setShowAll] = useState<string | null>(null);
  const [glossary, setGlossary] = useState<GlossaryEntry[] | null>(null);
  const [editing, setEditing] = useState<{ index: number; source: string; target: string } | null>(null);
  // Character chosen to be joined with another one ("same person").
  const [joining, setJoining] = useState<NotebookCharacter | null>(null);
  const [joinQuery, setJoinQuery] = useState('');
  // Character being given a new main name, and the name typed so far.
  const [renaming, setRenaming] = useState<{ name: string; to: string } | null>(null);

  useEffect(() => {
    let alive = true;
    loadGlossary(id).then((g) => alive && setGlossary(g));
    return () => {
      alive = false;
    };
  }, [id, job?.running]);

  // Never show what lies beyond the reading point.
  const upTo = book?.progress?.index ?? (book?.downloaded.length ? Math.max(...book.downloaded) : -1);
  // Short character cards: write the missing ones when the notebook is opened.
  useEffect(() => {
    if (upTo >= 0) refreshProfiles(id, upTo).catch(() => undefined);
  }, [id, upTo]);
  const missing = useMemo(() => (nb && book ? missingChapters(id, nb, upTo, lang) : []), [nb, book, id, upTo, lang]);
  const q = normName(query);

  const characters = useMemo(() => {
    const list = (nb?.characters ?? []).filter((c) => c.firstChapter <= upTo);
    const filtered = q
      ? list.filter((c) => normName(c.name).includes(q) || normName(c.nameTr ?? '').includes(q) || c.aliases.some((a) => normName(a).includes(q)) || c.notes.some((n) => normName(noteText(n, lang)).includes(q)))
      : list;
    return filtered.sort((a, b) => b.seenIn.length - a.seenIn.length || a.firstChapter - b.firstChapter);
  }, [nb, q, upTo, lang]);
  // Main characters first, then side characters (newest faces on top), each under a heading.
  const rows = useMemo(() => {
    const { main, side } = splitCast(characters, upTo);
    const out: ({ heading: string } | NotebookCharacter)[] = [];
    if (main.length) out.push({ heading: `Ana karakterler · ${main.length}` }, ...main);
    if (side.length) out.push({ heading: `Yan karakterler · ${side.length}` }, ...side);
    return out;
  }, [characters, upTo]);

  const summaries = useMemo(() => {
    const en = nb?.summariesEn ?? {};
    const entries = Object.entries(nb?.summaries ?? {})
      .map(([k, v]) => ({ index: Number(k), text: (lang === 'en' && en[k]) || v }))
      .filter((e) => e.index <= upTo && e.text !== '—')
      .sort((a, b) => a.index - b.index);
    return q ? entries.filter((e) => normName(e.text).includes(q) || String(e.index + 1) === query.trim()) : entries;
  }, [nb, q, query, upTo, lang]);

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
    fillNotebook(id, upTo, lang).catch(() => undefined);
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

  const characterMenu = (c: NotebookCharacter) =>
    Alert.alert(
      displayName(c, lang),
      'Bu kayıtla ne yapılsın? (Vazgeçmek için dışarı dokun.)',
      [
        { text: 'Sil', style: 'destructive', onPress: () => deleteCharacter(c) },
        { text: 'Adını değiştir', onPress: () => setRenaming({ name: c.name, to: c.name }) },
        {
          text: 'Birleştir',
          onPress: () => {
            setJoinQuery('');
            setJoining(c);
          },
        },
      ],
      { cancelable: true },
    );

  const saveRename = () => {
    if (!renaming) return;
    const { name, to } = renaming;
    setRenaming(null);
    if (to.trim() && to.trim() !== name) editNotebook(id, (n) => renameCharacter(n, name, to)).catch(() => undefined);
  };

  const joinWith = (other: NotebookCharacter) => {
    if (!joining) return;
    const a = joining;
    setJoining(null);
    editNotebook(id, (n) => mergeCharacterGroups(n, [[other.name, a.name]])).catch(() => undefined);
  };

  const findSame = () => {
    if (!settings.hasGeminiKey) {
      Alert.alert('Gemini anahtarı gerekli', 'Bunun için Ayarlar’dan Gemini anahtarınızı girin.');
      return;
    }
    joinSameCharacters(id).catch(() => undefined);
  };

  const reset = () => {
    if (!settings.hasGeminiKey) {
      Alert.alert('Gemini anahtarı gerekli', 'Bunun için Ayarlar’dan Gemini anahtarınızı girin.');
      return;
    }
    Alert.alert(
      'Defter sıfırdan kurulsun mu?',
      `Tüm karakterler ve özetler silinir, okuduğun ${upTo + 1} bölüm baştan okunup yeniden yazılır. Yanlış birleşmiş karakterler böylece ayrılır. Uzun sürer; Gemini hakkı biterse ertesi gün “Güncelle” ile kaldığı yerden devam eder. Elle verdiğin adlar korunur.`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Sıfırdan kur', style: 'destructive', onPress: () => resetNotebook(id, upTo, lang).catch(() => undefined) },
      ],
    );
  };

  const rebuild = () => {
    if (!settings.hasGeminiKey) {
      Alert.alert('Gemini anahtarı gerekli', 'Bunun için Ayarlar’dan Gemini anahtarınızı girin.');
      return;
    }
    Alert.alert(
      'Defter baştan düzenlensin mi?',
      'Aynı kişinin kayıtları birleştirilir ve her karakterin kısa kartı (en fazla 5 madde) okuduğun yere kadarki notlardan yeniden yazılır. Bölüm notları silinmez. Birkaç dakika sürebilir.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Düzenle', onPress: () => rebuildNotebook(id, upTo).catch(() => undefined) },
      ],
    );
  };

  const deleteCharacter = (c: NotebookCharacter) =>
    Alert.alert(`${displayName(c, lang)} defterden silinsin mi?`, 'Yanlış ya da gereksiz bir kayıtsa silebilirsiniz.', [
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
              {job.message}
              {job.total ? ` · ${job.done}/${job.total}` : ''}
            </Text>
            <Button small variant="secondary" title="Durdur" onPress={() => stopNotebookJob(id)} />
          </>
        ) : (
          <>
            <Text style={ui.text}>
              {missing.length
                ? `Okuduğun yere kadar (${upTo + 1}. bölüm) ${missing.length} bölümün ${lang === 'en' ? 'İngilizce' : 'Türkçe'} notu yok ya da eksik.`
                : `Defter ${upTo + 1}. bölüme kadar güncel.`}
            </Text>
            <Text style={ui.muted}>
              Yeni bölüme geçince son okuduğun bölümler deftere kendiliğinden eklenir. Daha eski eksik bölümler için “Güncelle”ye bas. Okuduğun yerden ilerisi gösterilmez.
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
      {tab === 'characters' && (nb?.characters.length ?? 0) > 1 && !job?.running && (
        <>
          <Button small variant="secondary" title="Baştan düzenle (birleştir + kartları yeniden yaz)" onPress={rebuild} />
          <Button small variant="secondary" title="Aynı kişileri bul ve birleştir" onPress={findSame} />
          <Button small variant="danger" title="Defteri sıfırdan kur" onPress={reset} />
          <Text style={ui.muted}>Bir karaktere basılı tutarak adını değiştirebilir, elle birleştirebilir ya da silebilirsin.</Text>
        </>
      )}
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
          data={rows}
          keyExtractor={(c) => ('heading' in c ? `#${c.heading}` : c.name)}
          ListHeaderComponent={header}
          ListEmptyComponent={empty(nb ? 'Henüz karakter yok. “Güncelle” ile okuduğun bölümleri deftere işleyebilirsin.' : 'Yükleniyor…')}
          contentContainerStyle={{ padding: 16, paddingBottom: 16 + insets.bottom }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            if ('heading' in item) return <Text style={[styles.name, { color: colors.accent, marginTop: 8, marginBottom: 4 }]}>{item.heading}</Text>;
            const c = item;
            const expanded = open === c.name;
            const notes = c.notes.filter((n) => n.chapter <= upTo);
            const card = profileFor(c, upTo);
            // Without a card, at most the latest few notes stand in for it; the rest are behind "Bölüm notları".
            const traits = card ? (lang === 'tr' ? card.traitsTr : card.traitsEn) : notes.length > MAX_NOTES_SHOWN ? notes.slice(-MAX_NOTES_SHOWN).map((n) => noteText(n, lang)) : null;
            const aliases = aliasesFor(c, lang, upTo);
            const showNotes = !traits || showAll === c.name;
            return (
              <Pressable onPress={() => setOpen(expanded ? null : c.name)} onLongPress={() => characterMenu(c)} style={styles.item}>
                <View style={[ui.row, { justifyContent: 'space-between' }]}>
                  <Text style={styles.name}>{displayName(c, lang)}</Text>
                  <Text style={{ color: colors.muted }}>{expanded ? '▴' : '▾'}</Text>
                </View>
                {!!aliases.length && <Text style={ui.muted}>{lang === 'tr' ? 'Diğer adları' : 'Also called'}: {aliases.join(', ')}</Text>}
                <Text style={ui.muted}>
                  {c.firstChapter + 1}. bölümde tanıtıldı · {c.seenIn.filter((x) => x <= upTo).length} bölümde geçiyor
                </Text>
                {!expanded && (traits ? (
                  <Text style={ui.text} numberOfLines={2}>
                    {traits.join(' · ')}
                  </Text>
                ) : (
                  !!notes.length && (
                    <Text style={ui.text} numberOfLines={2}>
                      {noteText(notes[0], lang)}
                    </Text>
                  )
                ))}
                {expanded &&
                  traits?.map((t, k) => (
                    <Text key={`t${k}`} style={ui.text}>
                      <Text style={{ color: colors.accent }}>• </Text>
                      {t}
                    </Text>
                  ))}
                {expanded && traits && notes.length > 0 && (
                  <Pressable onPress={() => setShowAll(showAll === c.name ? null : c.name)} hitSlop={6}>
                    <Text style={[ui.muted, { color: colors.accent, marginTop: 4 }]}>
                      {showAll === c.name ? 'Bölüm notlarını gizle ▴' : `Bölüm notları (${notes.length}) ▾`}
                    </Text>
                  </Pressable>
                )}
                {expanded &&
                  showNotes &&
                  notes.map((n, k) => (
                    <Text key={k} style={ui.text}>
                      <Text style={{ color: colors.accent }}>{n.chapter + 1}. </Text>
                      {noteText(n, lang)}
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
      <Modal visible={!!renaming} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <Pressable style={styles.backdrop} onPress={() => setRenaming(null)}>
          <Pressable style={styles.dialog}>
            <Text style={ui.h2}>Asıl adı</Text>
            <Text style={ui.muted}>Karakterin gerçek adını yaz (ör. Chu Yang). Eski ad “Diğer adları”na geçer ve bu ad bir daha kendiliğinden değişmez.</Text>
            <TextInput
              value={renaming?.to ?? ''}
              onChangeText={(t) => setRenaming((r) => (r ? { ...r, to: t } : r))}
              autoFocus
              style={ui.input}
            />
            <View style={ui.row}>
              <Button variant="secondary" title="Vazgeç" onPress={() => setRenaming(null)} style={{ flex: 1 }} />
              <Button title="Kaydet" onPress={saveRename} style={{ flex: 1 }} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={!!joining} transparent animationType="fade" onRequestClose={() => setJoining(null)}>
        <Pressable style={styles.backdrop} onPress={() => setJoining(null)}>
          <Pressable style={[styles.dialog, { maxHeight: '80%' }]}>
            <Text style={styles.name}>{joining ? displayName(joining, lang) : ''} kiminle aynı kişi?</Text>
            <TextInput
              value={joinQuery}
              onChangeText={setJoinQuery}
              placeholder="Ara…"
              placeholderTextColor={colors.muted}
              style={ui.input}
            />
            <FlatList
              data={(nb?.characters ?? []).filter(
                (c) =>
                  c.name !== joining?.name &&
                  (!joinQuery.trim() ||
                    [c.name, c.nameTr ?? '', ...c.aliases].some((x) => normName(x).includes(normName(joinQuery)))),
              )}
              keyExtractor={(c) => c.name}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item: c }) => (
                <Pressable onPress={() => joinWith(c)} style={[styles.item, { marginBottom: 6 }]}>
                  <Text style={styles.name}>{displayName(c, lang)}</Text>
                  {!!c.aliases.length && (
                    <Text style={ui.muted} numberOfLines={1}>
                      {c.aliases.join(', ')}
                    </Text>
                  )}
                </Pressable>
              )}
            />
            <Button variant="secondary" title="Vazgeç" onPress={() => setJoining(null)} />
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
