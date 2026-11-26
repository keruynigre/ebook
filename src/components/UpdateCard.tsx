import { Image, Linking, Pressable, Switch, Text, View } from 'react-native';

import { setSettings, useSettings } from '../lib/settings';
import { colors } from '../lib/theme';
import { appVersion, checkForUpdate, RELEASES_PAGE, useUpdate, type UpdateInfo } from '../lib/updates';
import { APP_ICON } from './icons';
import { Button, Card, ui } from './ui';

function UpdateText({ u }: { u: UpdateInfo }) {
  return (
    <>
      <Text style={ui.text}>
        Yeni sürüm var: <Text style={{ color: colors.accent, fontWeight: '700' }}>{u.version}</Text> (şu an {appVersion()})
      </Text>
      {!!u.notes && <Text style={ui.muted}>Yenilik: {u.notes}</Text>}
    </>
  );
}

/** Banner on the library screen when a newer version is out (and not skipped). */
export function UpdateBanner() {
  const { update } = useUpdate();
  const settings = useSettings();
  if (!update || settings.skippedUpdate === update.version) return null;
  return (
    <Card style={{ gap: 8, borderColor: colors.accent, borderWidth: 1 }}>
      <UpdateText u={update} />
      <Text style={ui.muted}>“İndir”e basınca APK tarayıcıda iner; inince dokunup “Güncelle” deyin. Kitaplarınız silinmez.</Text>
      <View style={ui.row}>
        <Button title="İndir" onPress={() => Linking.openURL(update.apkUrl)} style={{ flex: 1 }} />
        <Button title="Sonra" variant="secondary" onPress={() => setSettings({ skippedUpdate: update.version })} />
      </View>
    </Card>
  );
}

/** Settings card: version, manual check, automatic check switch. */
export function UpdateCard() {
  const settings = useSettings();
  const { update, checking, error, checkedAt } = useUpdate();
  const check = async () => {
    const u = await checkForUpdate().catch(() => null);
    if (u) setSettings({ skippedUpdate: '' });
  };
  return (
    <Card style={{ gap: 10 }}>
      <View style={[ui.row, { alignItems: 'center', gap: 14 }]}>
        <Image source={APP_ICON} style={{ width: 64, height: 64, borderRadius: 16 }} />
        <View style={{ flex: 1 }}>
          <Text style={[ui.h2, { marginBottom: 2 }]}>Ebook</Text>
          <Text style={ui.text}>Sürüm {appVersion()}</Text>
        </View>
      </View>
      {update ? (
        <>
          <UpdateText u={update} />
          <Button title="Yeni sürümü indir" onPress={() => Linking.openURL(update.apkUrl)} />
        </>
      ) : (
        checkedAt > 0 && !error && !checking && <Text style={ui.muted}>En son sürümü kullanıyorsunuz.</Text>
      )}
      {!!error && <Text style={ui.error}>{error}</Text>}
      <Button title="Güncellemeleri denetle" variant="secondary" onPress={check} busy={checking} />
      <View style={[ui.row, { justifyContent: 'space-between' }]}>
        <View style={{ flex: 1 }}>
          <Text style={ui.text}>Açılışta denetle</Text>
          <Text style={ui.muted}>Yeni sürüm çıkınca kitaplık ekranında haber verir.</Text>
        </View>
        <Switch value={settings.checkUpdates !== false} onValueChange={(v) => setSettings({ checkUpdates: v })} trackColor={{ true: colors.accent }} />
      </View>
      <Pressable onPress={() => Linking.openURL(RELEASES_PAGE)}>
        <Text style={{ color: colors.accent, fontWeight: '700' }}>Bütün sürümler (GitHub) ↗</Text>
      </Pressable>
    </Card>
  );
}
