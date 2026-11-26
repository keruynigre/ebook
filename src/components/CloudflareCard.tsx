import { Image } from 'expo-image';
import { useState } from 'react';
import { Alert, Linking, Pressable, Switch, Text, TextInput, View } from 'react-native';

import { listAccounts } from '../lib/cloudflare';
import { chooseStyleImage, clearStyleImage, styleRefFile } from '../lib/comic';
import { chapterCost, type ComicQuality } from '../lib/comicCore';
import { setCfToken, setSettings, useSettings } from '../lib/settings';
import { colors } from '../lib/theme';
import { Button, Card, ui } from './ui';

const TOKEN_PAGE = 'https://dash.cloudflare.com/profile/api-tokens';

/** Settings card for the Cloudflare Workers AI token that draws comic panels. */
const QUALITIES: { id: ComicQuality; label: string; note: string }[] = [
  { id: 'high', label: 'Yüksek', note: '1024×768, bölüm başına 12-15 kare.' },
  { id: 'balanced', label: 'Dengeli', note: '768×576, bölüm başına 10-12 kare; telefonda fark çok az.' },
  { id: 'saver', label: 'Tasarruflu', note: '640×480, bölüm başına 8-10 kare; çizgiler biraz yumuşar.' },
];

export function CloudflareCard() {
  const settings = useSettings();
  const [token, setToken] = useState('');
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const save = async () => {
    const t = token.trim();
    if (!t) return;
    setBusy(true);
    setError('');
    setNote('');
    try {
      let id = account.trim() || settings.cfAccountId;
      if (!id) {
        const list = await listAccounts(t).catch(() => []);
        if (list.length === 1) id = list[0].id;
        else if (list.length > 1) throw new Error(`Birden fazla hesap var (${list.map((a) => a.name).join(', ')}). Hesap kimliğini de yapıştırın.`);
        else throw new Error('Hesap kimliği bulunamadı. Cloudflare panelinde sağ üstteki menüden “Account ID”yi kopyalayıp aşağıya yapıştırın.');
      }
      await setCfToken(t);
      setSettings({ cfAccountId: id });
      setToken('');
      setAccount('');
      setNote('Cloudflare anahtarı kaydedildi.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    await setCfToken(null);
    setSettings({ cfAccountId: '' });
    setNote('Cloudflare anahtarı silindi.');
  };

  return (
    <Card style={{ gap: 10 }}>
      <Text style={ui.h2}>Resimli okuma (Cloudflare)</Text>
      <Text style={ui.muted}>
        Okuyucudaki resim düğmesi bölümü siyah-beyaz çizgi romana çevirir: Gemini sahneleri ve konuşmaları seçer,
        Cloudflare’ın FLUX modeli kareleri çizer. Ücretsiz hesapta günlük çizim hakkı sınırlıdır.
      </Text>
      <Text style={ui.text}>
        {settings.hasCfToken && settings.cfAccountId ? '✓ Cloudflare anahtarı kayıtlı.' : 'Henüz Cloudflare anahtarı yok.'}
      </Text>
      {!settings.hasCfToken && (
        <View style={{ gap: 6 }}>
          <Text style={ui.muted}>
            1. Aşağıdaki bağlantıyı açıp Cloudflare hesabınızla girin.{'\n'}2. “Create Token” → “Workers AI” şablonunu
            seçin (“Use template”) → “Continue to summary” → “Create Token”.{'\n'}3. Çıkan anahtarı kopyalayıp buraya
            yapıştırın ve “Kaydet”e basın.
          </Text>
          <Pressable onPress={() => Linking.openURL(TOKEN_PAGE)}>
            <Text style={{ color: colors.accent, fontWeight: '700' }}>dash.cloudflare.com/profile/api-tokens ↗</Text>
          </Pressable>
        </View>
      )}
      <TextInput
        value={token}
        onChangeText={setToken}
        placeholder={settings.hasCfToken ? 'Yeni anahtarla değiştir' : 'Cloudflare API anahtarı'}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        style={ui.input}
      />
      <TextInput
        value={account}
        onChangeText={setAccount}
        placeholder={settings.cfAccountId ? `Hesap kimliği: ${settings.cfAccountId.slice(0, 6)}…` : 'Hesap kimliği (boş bırakılabilir)'}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        style={ui.input}
      />
      <View style={ui.row}>
        <Button title="Kaydet" onPress={save} busy={busy} disabled={!token.trim()} style={{ flex: 1 }} />
        {settings.hasCfToken && <Button title="Anahtarı sil" variant="danger" onPress={remove} />}
      </View>
      {!!error && <Text style={ui.error}>{error}</Text>}
      {!!note && <Text style={ui.muted}>{note}</Text>}

      <View style={[ui.row, { justifyContent: 'space-between', marginTop: 6 }]}>
        <View style={{ flex: 1 }}>
          <Text style={ui.text}>Renkli çiz</Text>
          <Text style={ui.muted}>Kapalıysa siyah-beyaz. Değişiklik yeni çizilen karelerde görünür.</Text>
        </View>
        <Switch value={settings.comicColor} onValueChange={(v) => setSettings({ comicColor: v })} trackColor={{ true: colors.accent }} />
      </View>

      <Text style={[ui.text, { marginTop: 6 }]}>Çizim kalitesi</Text>
      <View style={ui.row}>
        {QUALITIES.map((q) => (
          <Button
            key={q.id}
            small
            title={q.label}
            variant={settings.comicQuality === q.id ? 'primary' : 'secondary'}
            onPress={() => setSettings({ comicQuality: q.id })}
            style={{ flex: 1 }}
          />
        ))}
      </View>
      <Text style={ui.muted}>
        {QUALITIES.find((q) => q.id === settings.comicQuality)?.note} Ücretsiz günlük hakla yaklaşık{' '}
        {Math.floor(10_000 / chapterCost(settings.comicQuality))} bölüm çizilir (yeni karakterlerin kartları da biraz harcar).
      </Text>

      <Text style={[ui.text, { marginTop: 6 }]}>Tarz görseli</Text>
      <Text style={ui.muted}>
        Beğendiğin bir çizgi roman sayfası ya da çizim seçersen kareler o tarza benzer çizilir. Seçmezsen yazılı tarif
        kullanılır.
      </Text>
      {settings.comicStyleRef && (
        <Image source={{ uri: styleRefFile().uri }} style={{ width: 140, height: 140, borderRadius: 8 }} contentFit="cover" cachePolicy="none" />
      )}
      <View style={ui.row}>
        <Button
          title={settings.comicStyleRef ? 'Değiştir' : 'Görsel seç'}
          variant="secondary"
          onPress={() => chooseStyleImage().catch((e) => Alert.alert('Görsel seçilemedi', (e as Error).message))}
          style={{ flex: 1 }}
        />
        {settings.comicStyleRef && <Button title="Kaldır" variant="danger" onPress={clearStyleImage} />}
      </View>
    </Card>
  );
}
