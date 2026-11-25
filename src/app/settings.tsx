import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { Button, Card, ui } from '../components/ui';
import { listModels, type GeminiModel } from '../lib/gemini';
import { getGeminiKey, setGeminiKey, setSettings, useSettings } from '../lib/settings';
import { colors } from '../lib/theme';

const KEY_PAGE = 'https://aistudio.google.com/apikey';

export default function SettingsScreen() {
  const settings = useSettings();
  const [keyInput, setKeyInput] = useState('');
  const [models, setModels] = useState<GeminiModel[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const loadModels = async (key: string) => {
    setBusy(true);
    setError('');
    try {
      const list = await listModels(key);
      if (list.length === 0) throw new Error('Bu anahtarla kullanılabilen metin modeli bulunamadı.');
      setModels(list);
      if (!settings.geminiModel || !list.some((m) => m.name === settings.geminiModel)) {
        setSettings({ geminiModel: list[0].name });
      }
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!settings.hasGeminiKey) return;
    getGeminiKey().then((k) => {
      if (k) loadModels(k);
    });
    // Only on first open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveKey = async () => {
    const key = keyInput.trim();
    if (!key) return;
    setNote('');
    if (await loadModels(key)) {
      await setGeminiKey(key);
      setKeyInput('');
      setNote('Anahtar kaydedildi.');
    }
  };

  const removeKey = async () => {
    await setGeminiKey(null);
    setModels(null);
    setSettings({ autoTranslate: false });
    setNote('Anahtar silindi.');
  };

  return (
    <ScrollView style={ui.screen} contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: 10 }}>
        <Text style={ui.h2}>Türkçe çeviri (Gemini)</Text>
        <Text style={ui.muted}>
          Bölümler Google'ın Gemini yapay zekâsıyla edebi bir Türkçeye çevrilir. Karakter adları korunur; terimler kitap
          boyunca aynı kalsın diye her kitap için bir sözlük tutulur.
        </Text>
        <Text style={ui.text}>
          {settings.hasGeminiKey ? '✓ API anahtarı kayıtlı (telefonda şifreli saklanıyor).' : 'Henüz API anahtarı yok.'}
        </Text>

        {!settings.hasGeminiKey && (
          <View style={{ gap: 6 }}>
            <Text style={ui.muted}>
              1. Aşağıdaki bağlantıyı açıp Google hesabınızla girin.{'\n'}2. “Create API key” ile anahtar oluşturun ve
              kopyalayın.{'\n'}3. Buraya yapıştırıp “Kaydet”e basın.
            </Text>
            <Pressable onPress={() => Linking.openURL(KEY_PAGE)}>
              <Text style={{ color: colors.accent, fontWeight: '700' }}>aistudio.google.com/apikey ↗</Text>
            </Pressable>
          </View>
        )}

        <TextInput
          value={keyInput}
          onChangeText={setKeyInput}
          placeholder={settings.hasGeminiKey ? 'Yeni anahtarla değiştir' : 'API anahtarını yapıştırın'}
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={ui.input}
        />
        <View style={ui.row}>
          <Button title="Kaydet" onPress={saveKey} busy={busy} disabled={!keyInput.trim()} style={{ flex: 1 }} />
          {settings.hasGeminiKey && <Button title="Anahtarı sil" variant="danger" onPress={removeKey} />}
        </View>
        {!!error && <Text style={ui.error}>{error}</Text>}
        {!!note && <Text style={ui.muted}>{note}</Text>}
      </Card>

      {settings.hasGeminiKey && (
        <Card style={{ gap: 10 }}>
          <Text style={ui.h2}>Model</Text>
          <Text style={ui.muted}>
            “Flash” modelleri hızlıdır ve ücretsiz kullanım hakkı vardır. Ücretsiz hak günde sınırlıdır; dolarsa çeviri
            durur ve ertesi gün kaldığı yerden devam edebilirsiniz.
          </Text>
          {busy && !models && <Text style={ui.muted}>Modeller yükleniyor…</Text>}
          {models?.slice(0, 12).map((m) => {
            const selected = m.name === settings.geminiModel;
            return (
              <Pressable
                key={m.name}
                onPress={() => setSettings({ geminiModel: m.name })}
                style={{
                  padding: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: selected ? colors.accent : colors.border,
                  backgroundColor: selected ? '#2a2317' : 'transparent',
                }}
              >
                <Text style={[ui.text, { fontWeight: selected ? '700' : '400' }]}>
                  {selected ? '● ' : '○ '}
                  {m.displayName}
                </Text>
                <Text style={ui.muted}>{m.name.replace(/^models\//, '')}</Text>
              </Pressable>
            );
          })}
        </Card>
      )}

      <Card style={{ gap: 12 }}>
        <View style={[ui.row, { justifyContent: 'space-between' }]}>
          <View style={{ flex: 1 }}>
            <Text style={ui.text}>İndirirken otomatik çevir</Text>
            <Text style={ui.muted}>Her bölüm indikten hemen sonra Türkçeye çevrilir.</Text>
          </View>
          <Switch
            value={settings.autoTranslate}
            onValueChange={(v) => setSettings({ autoTranslate: v })}
            disabled={!settings.hasGeminiKey}
            trackColor={{ true: colors.accent }}
          />
        </View>
        <View style={[ui.row, { justifyContent: 'space-between' }]}>
          <View style={{ flex: 1 }}>
            <Text style={ui.text}>Okurken Türkçeyi göster</Text>
            <Text style={ui.muted}>Kapalıysa orijinal metin gösterilir.</Text>
          </View>
          <Switch
            value={settings.showTranslation}
            onValueChange={(v) => setSettings({ showTranslation: v })}
            trackColor={{ true: colors.accent }}
          />
        </View>
      </Card>

      <Text style={[ui.muted, { paddingHorizontal: 4 }]}>
        Not: Gemini'nin ücretsiz katmanında gönderilen metinler Google tarafından modelleri geliştirmek için
        kullanılabilir. Anahtarınız yalnızca bu telefonda saklanır ve sadece Google'a gönderilir.
      </Text>
    </ScrollView>
  );
}
