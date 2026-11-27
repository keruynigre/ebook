import { useEffect, useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { CloudflareCard } from '../components/CloudflareCard';
import { UpdateCard } from '../components/UpdateCard';
import { Button, Card, ProgressBar, ui } from '../components/ui';
import { createBackup, restoreBackup, type BackupProgress } from '../lib/backup';
import { DEFAULT_TRANSLATION_PROMPT, listModels, type GeminiModel } from '../lib/gemini';
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
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupProgress, setBackupProgress] = useState<BackupProgress | null>(null);
  const [backupNote, setBackupNote] = useState('');

  const runBackup = async (kind: 'backup' | 'restore') => {
    setBackupBusy(true);
    setBackupNote('');
    setBackupProgress(null);
    try {
      const res = kind === 'backup' ? await createBackup(setBackupProgress) : await restoreBackup(setBackupProgress);
      if (res) setBackupNote(res);
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (!/cancel|iptal/i.test(msg)) Alert.alert(kind === 'backup' ? 'Yedeklenemedi' : 'Geri yüklenemedi', msg);
    } finally {
      setBackupBusy(false);
      setBackupProgress(null);
    }
  };
  const askRestore = () =>
    Alert.alert(
      'Yedekten geri yükle',
      'Yedekteki kitaplar telefona yazılır; aynı kitap telefonda varsa yedekteki hâli onun yerine geçer. Diğer kitaplar korunur.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Yedek dosyasını seç', onPress: () => runBackup('restore') },
      ],
    );
  const [prompt, setPrompt] = useState(settings.translationPrompt || DEFAULT_TRANSLATION_PROMPT);
  const promptChanged = prompt.trim() !== (settings.translationPrompt || DEFAULT_TRANSLATION_PROMPT).trim();
  const isDefaultPrompt = !settings.translationPrompt || settings.translationPrompt.trim() === DEFAULT_TRANSLATION_PROMPT.trim();

  const loadModels = async (key: string) => {
    setBusy(true);
    setError('');
    try {
      const list = await listModels(key);
      if (list.length === 0) throw new Error('Bu anahtarla kullanılabilen metin modeli bulunamadı.');
      setModels(list);
      setSettings({ geminiModels: list.map((m) => m.name) });
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
      <UpdateCard />

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
            Seçtiğiniz model önce denenir. O model yoğunsa ya da günlük hakkı dolduysa uygulama listedeki sıradaki modele
            kendiliğinden geçer. “Flash” modelleri hızlıdır ve ücretsiz kullanım hakkı vardır.
          </Text>
          {busy && !models && <Text style={ui.muted}>Modeller yükleniyor…</Text>}
          {!!models?.length && <ModelPicker models={models.slice(0, 12)} value={settings.geminiModel} />}
        </Card>
      )}

      {settings.hasGeminiKey && (
        <Card style={{ gap: 10 }}>
          <Text style={ui.h2}>Aynı anda çevrilecek bölüm</Text>
          <Text style={ui.muted}>
            Ücretsiz kullanımda 1 kalsın; Google dakikada çok az isteğe izin veriyor. Google AI Studio’da ödemeyi
            açtıysanız 3–4 seçin, çeviri o kadar kat hızlanır (Flash ile bölüm başına maliyet çok düşüktür).
          </Text>
          <View style={ui.row}>
            {[1, 2, 3, 4].map((n) => (
              <Button
                key={n}
                small
                title={String(n)}
                variant={settings.translateConcurrency === n ? 'primary' : 'secondary'}
                onPress={() => setSettings({ translateConcurrency: n })}
                style={{ flex: 1 }}
              />
            ))}
          </View>
        </Card>
      )}

      <Card style={{ gap: 10 }}>
        <Text style={ui.h2}>Çeviri talimatı</Text>
        <Text style={ui.muted}>
          Gemini her bölümü bu talimata göre çevirir. Uygulamanın yanıtı okuyabilmesi için gereken teknik kurallar
          (paragraf düzeni, terim sözlüğü, notların ayrı listede verilmesi) otomatik olarak eklenir. Notlar bölüm sonunda
          “Çevirmen notları” olarak gösterilir.
        </Text>
        <TextInput
          value={prompt}
          onChangeText={setPrompt}
          multiline
          textAlignVertical="top"
          style={[ui.input, { minHeight: 220, fontSize: 13, lineHeight: 18 }]}
        />
        <View style={ui.row}>
          <Button
            title="Talimatı kaydet"
            onPress={() => {
              const t = prompt.trim();
              setSettings({ translationPrompt: t === DEFAULT_TRANSLATION_PROMPT.trim() ? '' : t });
              setNote('Çeviri talimatı kaydedildi. Yeni çevrilen bölümlerde kullanılacak.');
            }}
            disabled={!promptChanged || !prompt.trim()}
            style={{ flex: 1 }}
          />
          {!isDefaultPrompt && (
            <Button
              title="Varsayılana dön"
              variant="secondary"
              onPress={() => {
                setPrompt(DEFAULT_TRANSLATION_PROMPT);
                setSettings({ translationPrompt: '' });
              }}
            />
          )}
        </View>
      </Card>

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
            <Text style={ui.text}>Açtığım bölümü kendiliğinden çevir</Text>
            <Text style={ui.muted}>Çevrilmemiş bir bölümü açınca çeviri hemen başlar, sonraki bölüm de önceden çevrilir.</Text>
          </View>
          <Switch
            value={settings.translateOnOpen}
            onValueChange={(v) => setSettings({ translateOnOpen: v })}
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

      <CloudflareCard />

      <Card style={{ gap: 10 }}>
        <Text style={ui.h2}>Yedekleme</Text>
        <Text style={ui.muted}>
          Bütün kitaplar (bölümler, çeviriler, resimler, kaldığın yerler, terim sözlükleri), kelime defteri ve ayarlar tek bir .zip dosyasına
          yazılır. İndirilenler gibi bir klasör seçin; telefon değiştirince ya da uygulamayı yeniden kurunca bu dosyadan
          geri yükleyebilirsiniz. Gemini anahtarı güvenlik için yedeğe girmez.
        </Text>
        <View style={ui.row}>
          <Button title="Yedekle" onPress={() => runBackup('backup')} busy={backupBusy} disabled={backupBusy} style={{ flex: 1 }} />
          <Button title="Geri yükle" variant="secondary" onPress={askRestore} disabled={backupBusy} style={{ flex: 1 }} />
        </View>
        {backupProgress && (
          <View style={{ gap: 6 }}>
            {backupProgress.value !== undefined && <ProgressBar value={backupProgress.value} />}
            <Text style={ui.muted}>{backupProgress.message}</Text>
          </View>
        )}
        {!!backupNote && <Text style={ui.text}>{backupNote}</Text>}
      </Card>

      <Text style={[ui.muted, { paddingHorizontal: 4 }]}>
        Not: Gemini'nin ücretsiz katmanında gönderilen metinler Google tarafından modelleri geliştirmek için
        kullanılabilir. Anahtarınız yalnızca bu telefonda saklanır ve sadece Google'a gönderilir.
      </Text>
    </ScrollView>
  );
}

const short = (name: string) => name.replace(/^models\//, '');

/** One field showing the chosen model; tapping it opens the list in a pop-up. */
function ModelPicker({ models, value }: { models: GeminiModel[]; value?: string }) {
  const [open, setOpen] = useState(false);
  const current = models.find((m) => m.name === value);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: 12,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: colors.accent,
          backgroundColor: '#2a2317',
        }}
        accessibilityLabel="Model seç"
      >
        <View style={{ flex: 1 }}>
          <Text style={[ui.text, { fontWeight: '700' }]}>{current?.displayName ?? 'Model seçin'}</Text>
          {!!value && <Text style={ui.muted}>{short(value)}</Text>}
        </View>
        <Text style={{ color: colors.accent, fontSize: 18, marginLeft: 8 }}>▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <Pressable
          onPress={() => setOpen(false)}
          style={{ flex: 1, backgroundColor: '#000a', justifyContent: 'center', padding: 24 }}
        >
          <Pressable
            onPress={() => undefined}
            style={{ maxHeight: '80%', borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, padding: 12 }}
          >
            <Text style={[ui.h2, { marginBottom: 8, paddingHorizontal: 4 }]}>Model seç</Text>
            <ScrollView contentContainerStyle={{ gap: 8 }}>
              {models.map((m) => {
                const selected = m.name === value;
                return (
                  <Pressable
                    key={m.name}
                    onPress={() => {
                      setSettings({ geminiModel: m.name });
                      setOpen(false);
                    }}
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
                    <Text style={ui.muted}>{short(m.name)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
