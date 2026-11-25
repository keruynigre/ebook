import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, ProgressBar } from '../../../components/ui';
import { startDownload, useDownload } from '../../../lib/downloads';
import { getBook, saveProgress, useBook } from '../../../lib/library';
import { READER_THEMES, setSettings, useSettings, type ReaderTheme } from '../../../lib/settings';
import { loadChapter, loadTranslation } from '../../../lib/storage';
import { colors } from '../../../lib/theme';
import type { ChapterContent } from '../../../lib/types';

const SAVE_EVERY_MS = 1500;

export default function Reader() {
  const { id, index } = useLocalSearchParams<{ id: string; index: string }>();
  const i = parseInt(index, 10) || 0;
  const book = useBook(id);
  const download = useDownload(id);
  const settings = useSettings();
  const theme = READER_THEMES[settings.theme];
  const insets = useSafeAreaInsets();

  const scroll = useRef<ScrollViewInstance>(null);
  const [chapter, setChapter] = useState<ChapterContent | null | undefined>(undefined);
  const [showSettings, setShowSettings] = useState(false);
  const [translation, setTranslation] = useState<ChapterContent | null>(null);
  const isTranslated = !!book?.translated?.includes(i);

  // Scroll position as a share of the chapter (0–1), so it survives font size changes.
  const position = useRef(0);
  const restoreTo = useRef<number | null>(null);
  const sizes = useRef({ content: 0, view: 0 });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    saveProgress(id, i, position.current).catch(() => undefined);
  }, [id, i]);

  useEffect(() => {
    let alive = true;
    const saved = getBook(id)?.progress;
    restoreTo.current = saved && saved.index === i ? saved.position : 0;
    position.current = restoreTo.current;
    setChapter(undefined);
    loadChapter(id, i)
      .then((c) => alive && setChapter(c))
      .catch(() => alive && setChapter(null));
    saveProgress(id, i, position.current).catch(() => undefined);
    return () => {
      alive = false;
      save();
    };
  }, [id, i, save]);

  // Load (or reload, once a translation finishes) the Turkish text.
  useEffect(() => {
    let alive = true;
    setTranslation(null);
    if (isTranslated) loadTranslation(id, i).then((t) => alive && setTranslation(t)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id, i, isTranslated]);

  const shown = settings.showTranslation && translation ? translation : chapter;

  const tryRestore = () => {
    const target = restoreTo.current;
    const { content, view } = sizes.current;
    if (target === null || content <= view || !chapter) return;
    scroll.current?.scrollTo({ y: target * (content - view), animated: false });
    restoreTo.current = null;
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const range = contentSize.height - layoutMeasurement.height;
    position.current = range > 0 ? Math.min(1, Math.max(0, contentOffset.y / range)) : 0;
    if (!saveTimer.current) saveTimer.current = setTimeout(save, SAVE_EVERY_MS);
  };

  const total = book?.chapters.length ?? 0;
  const has = (k: number) => !!book?.downloaded.includes(k);
  const go = (k: number) => {
    save();
    restoreTo.current = 0;
    router.setParams({ index: String(k) });
  };
  const title = (shown === translation && translation?.title) || book?.chapters[i]?.title || chapter?.title || '';
  const nextExists = i + 1 < total;
  const nextMissing = nextExists && !has(i + 1);
  const downloading = !!download?.running;

  const downloadNext = () => {
    const indexes = Array.from({ length: Math.min(10, total - i - 1) }, (_, k) => i + 1 + k);
    startDownload(id, indexes, { translate: settings.autoTranslate || (settings.showTranslation && isTranslated) }).catch(
      () => undefined,
    );
  };

  const changeFont = (delta: number) =>
    setSettings({ fontSize: Math.min(30, Math.max(13, settings.fontSize + delta)) });

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Stack.Screen
        options={{
          title: total ? `${i + 1} / ${total}` : '',
          headerStyle: { backgroundColor: theme.bg },
          headerTintColor: theme.text,
          contentStyle: { backgroundColor: theme.bg },
          headerRight: () => (
            <Pressable onPress={() => setShowSettings((v) => !v)} hitSlop={10} style={{ paddingHorizontal: 8 }}>
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>Aa</Text>
            </Pressable>
          ),
        }}
      />

      {showSettings && (
        <View style={[styles.panel, { backgroundColor: theme.bg, borderColor: theme.muted }]}>
          <View style={styles.panelRow}>
            <Text style={[styles.panelLabel, { color: theme.text }]}>Yazı boyutu</Text>
            <Button small variant="secondary" title="A−" onPress={() => changeFont(-1)} />
            <Text style={{ color: theme.text, width: 32, textAlign: 'center' }}>{settings.fontSize}</Text>
            <Button small variant="secondary" title="A+" onPress={() => changeFont(1)} />
          </View>
          <View style={styles.panelRow}>
            <Text style={[styles.panelLabel, { color: theme.text }]}>Satır aralığı</Text>
            {[1.4, 1.6, 1.9].map((lh) => (
              <Button
                key={lh}
                small
                variant={settings.lineHeight === lh ? 'primary' : 'secondary'}
                title={lh === 1.4 ? 'Sık' : lh === 1.6 ? 'Normal' : 'Geniş'}
                onPress={() => setSettings({ lineHeight: lh })}
              />
            ))}
          </View>
          <View style={styles.panelRow}>
            <Text style={[styles.panelLabel, { color: theme.text }]}>Dil</Text>
            <Button
              small
              variant={settings.showTranslation ? 'primary' : 'secondary'}
              title="Türkçe"
              onPress={() => setSettings({ showTranslation: true })}
            />
            <Button
              small
              variant={!settings.showTranslation ? 'primary' : 'secondary'}
              title="Orijinal"
              onPress={() => setSettings({ showTranslation: false })}
            />
          </View>
          <View style={styles.panelRow}>
            <Text style={[styles.panelLabel, { color: theme.text }]}>Tema</Text>
            {(Object.keys(READER_THEMES) as ReaderTheme[]).map((t) => (
              <Pressable
                key={t}
                onPress={() => setSettings({ theme: t })}
                style={[
                  styles.swatch,
                  { backgroundColor: READER_THEMES[t].bg, borderColor: settings.theme === t ? colors.accent : theme.muted },
                ]}
              >
                <Text style={{ color: READER_THEMES[t].text, fontSize: 13, fontWeight: '600' }}>{READER_THEMES[t].label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <ScrollView
        ref={scroll}
        onScroll={onScroll}
        scrollEventThrottle={100}
        onLayout={(e) => {
          sizes.current.view = e.nativeEvent.layout.height;
          tryRestore();
        }}
        onContentSizeChange={(_w, h) => {
          sizes.current.content = h;
          tryRestore();
        }}
        contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 16, paddingBottom: 28 + insets.bottom }}
      >
        <Text style={{ color: theme.text, fontSize: settings.fontSize + 5, fontWeight: '700', marginBottom: 18, lineHeight: (settings.fontSize + 5) * 1.3 }}>
          {title}
        </Text>
        {chapter === null && <Text style={{ color: colors.danger }}>Bu bölüm indirilmemiş.</Text>}
        {shown?.paragraphs.map((p, k) => (
          <Text
            key={k}
            selectable
            style={{
              color: theme.text,
              fontSize: settings.fontSize,
              lineHeight: Math.round(settings.fontSize * settings.lineHeight),
              marginBottom: Math.round(settings.fontSize * 0.75),
              textAlign: /^[*\s~=\-–—•·]{3,}$/.test(p) ? 'center' : 'left',
            }}
          >
            {p}
          </Text>
        ))}

        {chapter && settings.showTranslation && !isTranslated && (
          <View style={{ gap: 6, marginTop: 4, marginBottom: 8 }}>
            {settings.hasGeminiKey ? (
              <Button
                small
                variant="secondary"
                title={downloading ? 'Çeviri sürüyor…' : 'Bu bölümü Türkçeye çevir'}
                disabled={downloading}
                onPress={() => startDownload(id, [i], { translate: true }).catch(() => undefined)}
              />
            ) : (
              <Text style={{ color: theme.muted, fontSize: 13 }}>Türkçe çeviri için Ayarlar’dan Gemini anahtarı girin.</Text>
            )}
            {download?.translateError && !downloading && (
              <Text style={{ color: colors.danger, fontSize: 13 }}>{download.translateError}</Text>
            )}
          </View>
        )}

        {chapter && (
          <View style={{ gap: 10, marginTop: 16 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="‹ Önceki" variant="secondary" onPress={() => go(i - 1)} disabled={!has(i - 1)} style={{ flex: 1 }} />
              <Button title="Sonraki ›" onPress={() => go(i + 1)} disabled={!has(i + 1)} style={{ flex: 1 }} />
            </View>
            {nextMissing && !downloading && (
              <Button title="Sonraki 10 bölümü indir" variant="secondary" onPress={downloadNext} />
            )}
            {downloading && download && (
              <View style={{ gap: 6 }}>
                <ProgressBar value={(download.done + download.failed) / Math.max(1, download.total)} />
                <Text style={{ color: theme.muted, fontSize: 13 }}>
                  İndiriliyor {download.done + download.failed + 1}/{download.total}
                  {has(i + 1) ? ' · sonraki bölüm hazır' : ''}
                </Text>
              </View>
            )}
            {!nextExists && <Text style={{ color: theme.muted, textAlign: 'center' }}>Son bölüme geldiniz.</Text>}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { padding: 12, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  panelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  panelLabel: { width: 100, fontSize: 14 },
  swatch: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 2 },
});
