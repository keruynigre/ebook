import { useState } from 'react';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';

import { listAccounts } from '../lib/cloudflare';
import { setCfToken, setSettings, useSettings } from '../lib/settings';
import { colors } from '../lib/theme';
import { Button, Card, ui } from './ui';

const TOKEN_PAGE = 'https://dash.cloudflare.com/profile/api-tokens';

/** Settings card for the Cloudflare Workers AI token that draws comic panels. */
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
        Okuyucudaki 🖼 düğmesi bölümü siyah-beyaz çizgi romana çevirir: Gemini sahneleri ve konuşmaları seçer,
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
    </Card>
  );
}
