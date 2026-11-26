import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BrowserHost } from '../components/BrowserHost';
import { FONT_FILES } from '../lib/fonts';
import { refreshLibrary } from '../lib/library';
import { loadSettings } from '../lib/settings';
import { colors } from '../lib/theme';
import { checkOnStart } from '../lib/updates';

export default function RootLayout() {
  // Reader fonts load in the background; text uses the system font until they are ready.
  useFonts(FONT_FILES);
  useEffect(() => {
    refreshLibrary().catch(() => undefined);
    loadSettings()
      .then(checkOnStart)
      .catch(() => undefined);
  }, []);

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.card },
            headerTintColor: colors.text,
            headerTitleStyle: { fontWeight: '700' },
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Kitaplığım' }} />
          <Stack.Screen name="add" options={{ title: 'Roman ekle' }} />
          <Stack.Screen name="settings" options={{ title: 'Ayarlar' }} />
          <Stack.Screen name="book/[id]" options={{ title: '' }} />
          <Stack.Screen name="read/[id]/[index]" options={{ title: '' }} />
          <Stack.Screen name="notebook/[id]" options={{ title: 'Hikâye defteri' }} />
          <Stack.Screen name="stats/[id]" options={{ title: 'Okuma istatistiği' }} />
          <Stack.Screen name="search/[id]" options={{ title: 'Kitapta ara' }} />
          <Stack.Screen name="words" options={{ title: 'Kelime defteri' }} />
        </Stack>
        <BrowserHost />
      </View>
    </SafeAreaProvider>
  );
}
