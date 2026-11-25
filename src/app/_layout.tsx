import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BrowserHost } from '../components/BrowserHost';
import { refreshLibrary } from '../lib/library';
import { loadSettings } from '../lib/settings';
import { colors } from '../lib/theme';

export default function RootLayout() {
  useEffect(() => {
    refreshLibrary().catch(() => undefined);
    loadSettings().catch(() => undefined);
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
          <Stack.Screen name="book/[id]" options={{ title: '' }} />
          <Stack.Screen name="read/[id]/[index]" options={{ title: '' }} />
        </Stack>
        <BrowserHost />
      </View>
    </SafeAreaProvider>
  );
}
