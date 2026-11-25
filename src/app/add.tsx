import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, Text, TextInput, View } from 'react-native';

import { Button, Card, ui } from '../components/ui';
import { http } from '../lib/http';
import { startDownload } from '../lib/downloads';
import { addOrUpdateBook } from '../lib/library';
import { sourceForUrl } from '../lib/sources';
import { colors } from '../lib/theme';
import type { NovelInfo } from '../lib/types';

function normalizeInput(s: string): string | null {
  const m = s.trim().match(/https?:\/\/\S+/i);
  const raw = m ? m[0] : s.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return u.toString();
  } catch {
    return null;
  }
}

export default function AddNovel() {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState<NovelInfo | null>(null);
  const [saving, setSaving] = useState(false);

  const paste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setInput(text.trim());
  };

  const lookUp = async () => {
    const url = normalizeInput(input);
    setError('');
    setInfo(null);
    if (!url) {
      setError('Geçerli bir bağlantı girin.');
      return;
    }
    setBusy(true);
    try {
      const source = sourceForUrl(url);
      setProgress(`${source.name} okunuyor…`);
      const result = await source.getNovel(url, http, (p) => setProgress(p.message));
      setInfo(result);
    } catch (e) {
      setError((e as Error).message || 'Bilinmeyen bir hata oluştu.');
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const save = async () => {
    if (!info) return;
    setSaving(true);
    try {
      const book = await addOrUpdateBook(info);
      // Download the whole book right away (runs in the background, can be stopped on the book page).
      const have = new Set(book.downloaded);
      const missing = book.chapters.map((_, i) => i).filter((i) => !have.has(i));
      if (missing.length) startDownload(book.id, missing).catch(() => undefined);
      router.replace({ pathname: '/book/[id]', params: { id: book.id } });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const source = info ? sourceForUrl(info.url) : null;

  return (
    <KeyboardAvoidingView style={ui.screen} behavior="height">
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: 10 }}>
          <Text style={ui.h2}>Romanın bağlantısı</Text>
          <Text style={ui.muted}>
            Romanın ana sayfasını (bölüm listesinin olduğu sayfa) açın ve adresini kopyalayın. NovelFull tam
            destekleniyor; diğer siteler deneysel.
          </Text>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="https://novelfull.com/roman-adi.html"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={lookUp}
            style={ui.input}
          />
          <View style={ui.row}>
            <Button title="Yapıştır" variant="secondary" onPress={paste} style={{ flex: 1 }} />
            <Button title="Bul" onPress={lookUp} busy={busy} disabled={!input.trim()} style={{ flex: 2 }} />
          </View>
          {!!progress && <Text style={ui.muted}>{progress}</Text>}
          {!!error && <Text style={ui.error}>{error}</Text>}
        </Card>

        {info && (
          <Card style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              {info.coverUrl ? (
                <Image source={{ uri: info.coverUrl }} style={{ width: 80, height: 115, borderRadius: 6 }} contentFit="cover" />
              ) : null}
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={ui.h1}>{info.title}</Text>
                {!!info.author && <Text style={ui.muted}>{info.author}</Text>}
                <Text style={ui.text}>{info.chapters.length} bölüm bulundu</Text>
                {source && <Text style={ui.muted}>Kaynak: {source.name}</Text>}
              </View>
            </View>
            {!!info.description && (
              <Text style={ui.muted} numberOfLines={6}>
                {info.description}
              </Text>
            )}
            <Text style={ui.muted}>
              İlk bölüm: {info.chapters[0]?.title}
              {'\n'}Son bölüm: {info.chapters[info.chapters.length - 1]?.title}
            </Text>
            <Button title="Kitaplığa ekle" onPress={save} busy={saving} />
          </Card>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
