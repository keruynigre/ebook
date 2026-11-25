import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  Modal,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, ProgressBar } from '../../../components/ui';
import { startDownload, useDownload } from '../../../lib/downloads';
import { getBook, saveProgress, useBook } from '../../../lib/library';
import { READER_FONTS, type ReaderFont } from '../../../lib/fonts';
import { READER_THEMES, setSettings, useSettings, type ReaderTheme } from '../../../lib/settings';
import { loadChapter, loadTranslation } from '../../../lib/storage';
import { colors } from '../../../lib/theme';
import type { ChapterContent } from '../../../lib/types';
import {
  narrateFrom,
  pauseNarration,
  restartNarration,
  resumeNarration,
  setNarrationRate,
  skipParagraph,
  startNarration,
  stopNarration,
  useNarration,
} from '../../../lib/tts/narrator';
import { VOICES, voiceName } from '../../../lib/tts/voices';

const SAVE_EVERY_MS = 1500;
const RATES = [0.75, 1, 1.15, 1.3, 1.5, 1.75, 2];

export default function Reader() {
  const { id, index } = useLocalSearchParams<{ id: string; index: string }>();
  const i = parseInt(index, 10) || 0;
  const book = useBook(id);
  const download = useDownload(id);
  const settings = useSettings();
  const theme = READER_THEMES[settings.theme];
  const font = READER_FONTS[settings.fontFamily] ?? READER_FONTS.system;
  const bodyFont = font.regular ? { fontFamily: font.regular } : null;
  // Custom fonts carry their own bold file; the system font uses fontWeight.
  const titleFont = font.bold ? { fontFamily: font.bold } : { fontWeight: '700' as const };
  const insets = useSafeAreaInsets();

  const scroll = useRef<ScrollViewInstance>(null);
  const [chapter, setChapter] = useState<ChapterContent | null | undefined>(undefined);
  const [showSettings, setShowSettings] = useState(false);
  const [showFonts, setShowFonts] = useState(false);
  const [showVoices, setShowVoices] = useState(false);
  const narr = useNarration();
  // Paragraph positions inside the scroll content, for auto-scroll and "start here".
  const paraLayout = useRef<{ y: number; h: number }[]>([]);
  const scrollY = useRef(0);
  const userScrollAt = useRef(0);
  const [translation, setTranslation] = useState<ChapterContent | null>(null);
  // Which chapter the loaded texts belong to (state lags one render behind the route).
  const [loadedIdx, setLoadedIdx] = useState({ chapter: -1, translation: -1 });
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
      .then((c) => {
        if (!alive) return;
        setChapter(c);
        setLoadedIdx((x) => ({ ...x, chapter: i }));
      })
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
    if (isTranslated)
      loadTranslation(id, i)
        .then((t) => {
          if (!alive) return;
          setTranslation(t);
          setLoadedIdx((x) => ({ ...x, translation: i }));
        })
        .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id, i, isTranslated]);

  const shown = settings.showTranslation && translation ? translation : chapter;
  const originalLang: 'tr' | 'en' = book?.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en';
  const shownLang: 'tr' | 'en' = shown && shown === translation ? 'tr' : originalLang;
  const textSettled =
    !!chapter && loadedIdx.chapter === i && (!isTranslated || !settings.showTranslation || loadedIdx.translation === i);
  const narrHere = narr.bookId === id && narr.chapter === i && narr.status !== 'idle';
  const highlightOn = narrHere && narr.lang === shownLang;
  const narrActive = narr.bookId === id && narr.status !== 'idle';

  // Follow the narration into the next chapter.
  const lastNarrChapter = useRef(narr.chapter);
  useEffect(() => {
    const prev = lastNarrChapter.current;
    lastNarrChapter.current = narr.chapter;
    if (narr.bookId === id && narr.status !== 'idle' && prev === i && narr.chapter !== i) {
      save();
      restoreTo.current = 0;
      router.setParams({ index: String(narr.chapter) });
    }
  }, [narr.chapter, narr.bookId, narr.status, id, i, save]);

  // Switching Türkçe/Orijinal while listening switches the voice too.
  useEffect(() => {
    if (narrHere && textSettled && shown && narr.lang !== shownLang) {
      startNarration(id, i, shown, shownLang, narr.para);
    }
  }, [narrHere, textSettled, shown, shownLang, narr.lang, narr.para, id, i]);

  // Keep the spoken word on screen unless the person is scrolling around.
  useEffect(() => {
    if (!highlightOn || Date.now() - userScrollAt.current < 4000) return;
    const view = sizes.current.view;
    let y = 0;
    if (narr.para >= 0) {
      const l = paraLayout.current[narr.para];
      const len = shown?.paragraphs[narr.para]?.length || 1;
      if (!l) return;
      y = l.y + (narr.start > 0 ? (narr.start / len) * l.h : 0);
    }
    const top = scrollY.current;
    if (y < top + view * 0.08 || y > top + view * 0.72) {
      scroll.current?.scrollTo({ y: Math.max(0, y - view * 0.3), animated: true });
    }
  }, [highlightOn, narr.para, narr.start, shown]);

  const firstVisiblePara = () => {
    if (scrollY.current < 40) return -1;
    const k = paraLayout.current.findIndex((l) => l && l.y + l.h > scrollY.current + 10);
    return k < 0 ? -1 : k;
  };
  const listen = () => {
    if (!shown) return;
    if (narrHere && narr.lang === shownLang) {
      if (narr.status === 'playing' || narr.status === 'loading') pauseNarration();
      else resumeNarration();
      return;
    }
    startNarration(id, i, shown, shownLang, firstVisiblePara());
  };
  const cycleRate = () => {
    const k = RATES.findIndex((r) => r >= settings.ttsRate - 0.001);
    setNarrationRate(RATES[(k + 1) % RATES.length]);
  };
  const chooseVoice = (voiceId: string, lang: 'tr' | 'en') => {
    setSettings(lang === 'tr' ? { ttsVoiceTr: voiceId } : { ttsVoiceEn: voiceId });
    setShowVoices(false);
    if (narrActive && narr.lang === lang) restartNarration();
  };

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
    scrollY.current = contentOffset.y;
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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Pressable onPress={listen} hitSlop={10} style={{ paddingHorizontal: 8 }} accessibilityLabel="Sesli oku">
                <Text style={{ color: theme.text, fontSize: 20 }}>{highlightOn && narr.status !== 'paused' ? '⏸' : '🎧'}</Text>
              </Pressable>
              <Pressable onPress={() => setShowSettings((v) => !v)} hitSlop={10} style={{ paddingHorizontal: 8 }}>
                <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>Aa</Text>
              </Pressable>
            </View>
          ),
        }}
      />

      {showSettings && (
        <ScrollView
          style={[styles.panel, { backgroundColor: theme.bg, borderColor: theme.muted, maxHeight: '60%' }]}
          contentContainerStyle={{ gap: 10 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.panelRow}>
            <Text style={[styles.panelLabel, { color: theme.text }]}>Yazı boyutu</Text>
            <Button small variant="secondary" title="A−" onPress={() => changeFont(-1)} />
            <Text style={{ color: theme.text, width: 32, textAlign: 'center' }}>{settings.fontSize}</Text>
            <Button small variant="secondary" title="A+" onPress={() => changeFont(1)} />
          </View>
          <View style={styles.panelRow}>
            <Text style={[styles.panelLabel, { color: theme.text }]}>Yazı tipi</Text>
            <Pressable
              onPress={() => setShowFonts(true)}
              style={[styles.select, { borderColor: theme.muted }]}
            >
              <Text style={[{ color: theme.text, fontSize: 15, flex: 1 }, bodyFont]} numberOfLines={1}>
                {font.label}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 14 }}>▾</Text>
            </Pressable>
          </View>
          <View style={styles.panelRow}>
            <Text style={[styles.panelLabel, { color: theme.text }]}>Sesli okuma</Text>
            <Pressable onPress={() => setShowVoices(true)} style={[styles.select, { borderColor: theme.muted }]}>
              <Text style={{ color: theme.text, fontSize: 15, flex: 1 }} numberOfLines={1}>
                {voiceName(settings.ttsVoiceTr)} · {voiceName(settings.ttsVoiceEn)}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 14 }}>▾</Text>
            </Pressable>
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
        </ScrollView>
      )}

      <Modal visible={showFonts} transparent animationType="fade" onRequestClose={() => setShowFonts(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShowFonts(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: theme.bg, borderColor: theme.muted }]}>
            <Text style={[styles.sheetTitle, { color: theme.text }]}>Yazı tipi</Text>
            <ScrollView>
              {(Object.keys(READER_FONTS) as ReaderFont[]).map((f) => {
                const item = READER_FONTS[f];
                const active = settings.fontFamily === f;
                return (
                  <Pressable
                    key={f}
                    onPress={() => {
                      setSettings({ fontFamily: f });
                      setShowFonts(false);
                    }}
                    style={[styles.fontRow, active && { backgroundColor: colors.accent + '33' }]}
                  >
                    <Text style={[{ color: theme.text, fontSize: 17 }, item.regular ? { fontFamily: item.regular } : null]}>
                      {item.label}
                    </Text>
                    <Text style={{ color: theme.muted, fontSize: 12 }}>{item.note}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showVoices} transparent animationType="fade" onRequestClose={() => setShowVoices(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShowVoices(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: theme.bg, borderColor: theme.muted }]}>
            <ScrollView>
              {(['tr', 'en'] as const).map((lang) => (
                <View key={lang}>
                  <Text style={[styles.sheetTitle, { color: theme.text, paddingTop: lang === 'en' ? 12 : 0 }]}>
                    {lang === 'tr' ? 'Türkçe metin için ses' : 'İngilizce metin için ses'}
                  </Text>
                  {VOICES.filter((v) => v.lang === lang).map((v) => {
                    const active = (lang === 'tr' ? settings.ttsVoiceTr : settings.ttsVoiceEn) === v.id;
                    return (
                      <Pressable
                        key={v.id}
                        onPress={() => chooseVoice(v.id, lang)}
                        style={[styles.fontRow, active && { backgroundColor: colors.accent + '33' }]}
                      >
                        <Text style={{ color: theme.text, fontSize: 17 }}>{v.name}</Text>
                        <Text style={{ color: theme.muted, fontSize: 12 }}>{v.note}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <ScrollView
        ref={scroll}
        onScroll={onScroll}
        scrollEventThrottle={100}
        onScrollBeginDrag={() => {
          userScrollAt.current = Date.now();
        }}
        onMomentumScrollEnd={() => {
          userScrollAt.current = Date.now();
        }}
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
        <Text
          style={[
            { color: theme.text, fontSize: settings.fontSize + 5, marginBottom: 18, lineHeight: (settings.fontSize + 5) * 1.3 },
            titleFont,
            highlightOn && narr.para === -1 ? { backgroundColor: colors.accent + '33' } : null,
          ]}
        >
          {title}
        </Text>
        {chapter === null && <Text style={{ color: colors.danger }}>Bu bölüm indirilmemiş.</Text>}
        {shown?.paragraphs.map((p, k) => (
          <Text
            key={k}
            selectable
            onLayout={(e) => {
              paraLayout.current[k] = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height };
            }}
            onPress={highlightOn ? () => narrateFrom(k) : undefined}
            style={{
              ...bodyFont,
              color: theme.text,
              fontSize: settings.fontSize,
              lineHeight: Math.round(settings.fontSize * settings.lineHeight),
              marginBottom: Math.round(settings.fontSize * 0.75),
              textAlign: /^[*\s~=\-–—•·]{3,}$/.test(p) ? 'center' : 'left',
            }}
          >
            {highlightOn && narr.para === k && narr.start >= 0 ? (
              <>
                {p.slice(0, narr.start)}
                <Text style={{ backgroundColor: colors.accent + '66' }}>{p.slice(narr.start, narr.end)}</Text>
                {p.slice(narr.end)}
              </>
            ) : (
              p
            )}
          </Text>
        ))}

        {!!shown?.notes?.length && (
          <View style={{ marginTop: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.muted, gap: 6 }}>
            <Text style={{ color: theme.muted, fontWeight: '700', fontSize: Math.max(13, settings.fontSize - 4) }}>Çevirmen notları</Text>
            {shown.notes.map((n, k) => (
              <Text key={k} selectable style={{ color: theme.muted, fontSize: Math.max(13, settings.fontSize - 4), lineHeight: Math.max(13, settings.fontSize - 4) * 1.45 }}>
                {n}
              </Text>
            ))}
          </View>
        )}

        {chapter && !isTranslated && (
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

      {(narrActive || (narr.bookId === id && !!narr.message)) && (
        <View style={[styles.player, { backgroundColor: theme.bg, borderColor: theme.muted, paddingBottom: 8 + insets.bottom }]}>
          {!!narr.message && (
            <Text style={{ color: narr.status === 'error' ? colors.danger : theme.muted, fontSize: 13 }}>{narr.message}</Text>
          )}
          {narrActive && (
            <View style={styles.playerRow}>
              <Pressable onPress={() => skipParagraph(-1)} hitSlop={8} style={styles.playerBtn}>
                <Text style={[styles.playerIcon, { color: theme.text }]}>⏮</Text>
              </Pressable>
              <Pressable
                onPress={() => (narr.status === 'playing' || narr.status === 'loading' ? pauseNarration() : resumeNarration())}
                hitSlop={8}
                style={[styles.playerBtn, styles.playerMain]}
              >
                <Text style={[styles.playerIcon, { color: colors.accentText }]}>
                  {narr.status === 'playing' || narr.status === 'loading' ? '⏸' : '▶'}
                </Text>
              </Pressable>
              <Pressable onPress={() => skipParagraph(1)} hitSlop={8} style={styles.playerBtn}>
                <Text style={[styles.playerIcon, { color: theme.text }]}>⏭</Text>
              </Pressable>
              <Pressable onPress={cycleRate} hitSlop={8} style={styles.playerBtn}>
                <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700' }}>{settings.ttsRate}×</Text>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.muted, fontSize: 12 }} numberOfLines={1}>
                  {narr.status === 'loading' ? 'Ses hazırlanıyor…' : voiceName(narr.lang === 'tr' ? settings.ttsVoiceTr : settings.ttsVoiceEn)}
                  {narr.chapter !== i ? ` · ${narr.chapter + 1}. bölüm` : ''}
                </Text>
              </View>
              <Pressable onPress={() => stopNarration()} hitSlop={8} style={styles.playerBtn}>
                <Text style={[styles.playerIcon, { color: theme.text }]}>✕</Text>
              </Pressable>
            </View>
          )}
          {!narrActive && (
            <Pressable onPress={() => stopNarration()}>
              <Text style={{ color: theme.muted, fontSize: 12, textAlign: 'right' }}>Kapat</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, flexGrow: 0 },
  panelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  panelLabel: { width: 100, fontSize: 14 },
  select: { flex: 1, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
  sheet: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 12, maxHeight: '75%' },
  sheetTitle: { fontSize: 16, fontWeight: '700', paddingHorizontal: 16, paddingBottom: 8 },
  fontRow: { paddingHorizontal: 16, paddingVertical: 10, gap: 2 },
  player: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 8, gap: 6 },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playerBtn: { minWidth: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  playerMain: { backgroundColor: colors.accent, width: 48, height: 48, borderRadius: 24 },
  playerIcon: { fontSize: 20 },
  swatch: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 2 },
});
