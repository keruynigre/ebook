import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  Modal,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChapterSheet } from '../../../components/ChapterSheet';
import { ICONS } from '../../../components/icons';
import { InlinePicture } from '../../../components/InlinePicture';
import { ReaderParagraph, type WordTap } from '../../../components/ReaderParagraph';
import { Button, ProgressBar } from '../../../components/ui';
import { WordBubble, type BubbleTarget } from '../../../components/WordBubble';
import { ensureComic, loadComicScript, panelFile, redoChapter, redrawPanel, stopComics, useComicJob, useComicVersion, type ComicScript } from '../../../lib/comic';
import { panelSlots } from '../../../lib/comicCore';
import { startDownload, useDownload } from '../../../lib/downloads';
import { chapterPosition, getBook, saveProgress, useBook } from '../../../lib/library';
import { autoFillNotebook } from '../../../lib/notebook';
import { READER_FONTS, type ReaderFont } from '../../../lib/fonts';
import { READER_THEMES, setSettings, useSettings, type ReaderTheme } from '../../../lib/settings';
import { countWords, FINISHED_AT, formatCount } from '../../../lib/readStats';
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
const LISTEN_ICON = require('../../../../assets/icons/listen.png');
const COMIC_ICON = require('../../../../assets/icons/comic.png');
const BACK_ICON = require('../../../../assets/icons/back.png');
const PLAY_ICON = require('../../../../assets/icons/play.png');
const PAUSE_ICON = require('../../../../assets/icons/pause.png');
const PREV_ICON = require('../../../../assets/icons/prev.png');
const NEXT_ICON = require('../../../../assets/icons/next.png');
/** Height of the top bar (chapter number, listen, Aa). */
const BAR_H = 52;
/** Auto-scroll: pixels per second for each speed level. */
const AUTO_PX = 4;
const AUTO_MAX = 20;
const RATES = [0.75, 1, 1.15, 1.3, 1.5, 1.75, 2];
const BUBBLE: Record<ReaderTheme, { card: string; text: string; muted: string; border: string }> = {
  dark: { card: '#262a33', text: '#eef0f4', muted: '#9aa0ad', border: '#3a3f4b' },
  sepia: { card: '#fbf5e6', text: '#3b2f1e', muted: '#7d6a4f', border: '#d9c9a6' },
  light: { card: '#ffffff', text: '#1a1a1a', muted: '#6b6b6b', border: '#d6d6d6' },
};

/** The sentence around a character position, for context-aware meanings. */
function sentenceAt(text: string, pos: number): string {
  const before = text.slice(0, pos);
  const startMatch = before.match(/.*[.!?…]["”’»)]*\s+/s);
  const start = startMatch ? startMatch[0].length : 0;
  const rest = text.slice(pos);
  const endMatch = rest.match(/[.!?…]["”’»)]*(\s|$)/);
  const end = endMatch ? pos + (endMatch.index ?? 0) + endMatch[0].length : text.length;
  return text.slice(start, end).trim().slice(0, 400);
}

export default function Reader() {
  const { id, index, para } = useLocalSearchParams<{ id: string; index: string; para?: string }>();
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
  const { height: winH, width: winW } = useWindowDimensions();

  const scroll = useRef<ScrollViewInstance>(null);
  const [chapter, setChapter] = useState<ChapterContent | null | undefined>(undefined);
  const [showSettings, setShowSettings] = useState(false);
  // Auto-scroll: shown (control visible) and running.
  const [autoOn, setAutoOn] = useState(false);
  const [autoRun, setAutoRun] = useState(false);
  const [showFonts, setShowFonts] = useState(false);
  const [showVoices, setShowVoices] = useState(false);
  const [showChapters, setShowChapters] = useState(false);
  const [bubble, setBubble] = useState<(BubbleTarget & { para: number }) | null>(null);
  const narr = useNarration();
  // Paragraph positions inside the scroll content, for auto-scroll and "start here".
  const paraLayout = useRef<{ y: number; h: number }[]>([]);
  const scrollY = useRef(0);
  // The top bar slides away as the text is scrolled on, as far as the finger moves, and back the same way.
  const barOff = useRef(0);
  const [barY] = useState(() => new Animated.Value(0));
  const snapBar = useCallback(
    (to: number) => {
      barOff.current = to;
      Animated.timing(barY, { toValue: -to, duration: 160, useNativeDriver: true }).start();
    },
    [barY],
  );
  // Finger on the text: the bar follows it. Momentum after lifting the finger moves it too, then it settles fully in or out.
  const dragging = useRef(false);
  const endTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleBar = useCallback(() => {
    if (endTimer.current) clearTimeout(endTimer.current);
    endTimer.current = null;
    const off = barOff.current;
    if (off > 0 && off < BAR_H) snapBar(off > BAR_H / 2 && scrollY.current > BAR_H ? BAR_H : 0);
  }, [snapBar]);
  const endDrag = useCallback(() => {
    // Without momentum no end event follows, so settle shortly unless momentum starts.
    if (endTimer.current) clearTimeout(endTimer.current);
    endTimer.current = setTimeout(() => {
      dragging.current = false;
      settleBar();
    }, 250);
  }, [settleBar]);
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

  // Word count of the text on screen, tagged with its chapter so a lagging render can't mix them up.
  const wordsRef = useRef({ index: -1, words: 0 });
  const [scrollPct, setScrollPct] = useState({ index: -1, pct: 0 });

  const save = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const words = wordsRef.current.index === i ? wordsRef.current.words : undefined;
    saveProgress(id, i, position.current, words).catch(() => undefined);
  }, [id, i]);

  useEffect(() => {
    let alive = true;
    restoreTo.current = chapterPosition(id, i);
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

  // Translate the chapter as soon as it is opened (setting), and the next one so it is ready in time.
  useEffect(() => {
    if (!settings.translateOnOpen || !settings.showTranslation || !settings.hasGeminiKey) return;
    const t = setTimeout(() => {
      const b = getBook(id);
      if (!b?.downloaded.includes(i)) return;
      const want = [i, i + 1].filter((k) => b.downloaded.includes(k) && !b.translated?.includes(k));
      if (want.length) startDownload(id, want, { translate: true }).catch(() => undefined);
    }, 1_500);
    return () => clearTimeout(t);
  }, [id, i, settings.translateOnOpen, settings.showTranslation, settings.hasGeminiKey]);

  // Pictures of the key moments, inside the text (setting "illustrate", 🖼 in the top bar).
  const drawReady = settings.hasCfToken && !!settings.cfAccountId && settings.hasGeminiKey;
  const illustrate = settings.illustrate && drawReady;
  const comicJob = useComicJob(id, i);
  const comicV = useComicVersion();
  const [pictures, setPictures] = useState<{ index: number; script: ComicScript | null }>({ index: -1, script: null });
  useEffect(() => {
    if (!illustrate) return;
    let alive = true;
    loadComicScript(id, i).then((sc) => alive && setPictures({ index: i, script: sc }));
    return () => {
      alive = false;
    };
  }, [id, i, comicV, illustrate]);
  useEffect(() => {
    if (!illustrate) return;
    // Start after a short stay, so flipping through chapters does not spend the drawing allowance.
    const t = setTimeout(() => {
      if (getBook(id)?.downloaded.includes(i)) ensureComic(id, i);
    }, 3_000);
    return () => clearTimeout(t);
  }, [id, i, illustrate]);
  // Draw the next chapter ahead once this one is finished.
  useEffect(() => {
    const b = getBook(id);
    if (illustrate && comicJob && !comicJob.running && !comicJob.error && comicJob.total > 0 && comicJob.done === comicJob.total && b?.downloaded.includes(i + 1)) {
      ensureComic(id, i + 1);
    }
  }, [illustrate, comicJob, id, i]);
  const toggleIllustrate = () => {
    if (!drawReady) {
      Alert.alert('Resimler için anahtar gerekli', 'Bölümün önemli anlarına resim eklemek için Ayarlar’dan Cloudflare ve Gemini anahtarlarını girin.', [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Ayarlara git', onPress: () => router.push('/settings') },
      ]);
      return;
    }
    setSettings({ illustrate: !settings.illustrate });
  };
  const pictureMenu = (p: number) =>
    Alert.alert('Resim', 'Beğenmediysen yeniden çizilebilir (günlük çizim hakkından düşer).', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Bölümün resimlerini baştan seç', onPress: () => redoChapter(id, i) },
      { text: 'Bu resmi yeniden çiz', onPress: () => redrawPanel(id, i, p) },
    ]);

  // Keep the story notebook up to date as the reader moves on (after a short stay, not while flipping through).
  const notebookLang: 'tr' | 'en' = settings.showTranslation ? 'tr' : 'en';
  useEffect(() => {
    const t = setTimeout(() => autoFillNotebook(id, i, notebookLang).catch(() => undefined), 8_000);
    return () => clearTimeout(t);
  }, [id, i, notebookLang]);

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
  const shownWords = useMemo(() => (shown ? countWords([shown.title ?? '', ...shown.paragraphs]) : 0), [shown]);
  useEffect(() => {
    if (textSettled && shownWords) wordsRef.current = { index: i, words: shownWords };
  }, [textSettled, shownWords, i]);
  const pct = scrollPct.index === i ? scrollPct.pct : Math.round(chapterPosition(id, i) * 100);
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
    setAutoRun(false);
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
  const shownRef = useRef<{ c: ChapterContent | null | undefined; lang: 'tr' | 'en' }>({ c: null, lang: 'en' });
  useEffect(() => {
    shownRef.current = { c: shown, lang: shownLang };
  }, [shown, shownLang]);
  const onWord = useCallback((tap: WordTap) => {
    const p = shownRef.current.c?.paragraphs[tap.para] ?? '';
    setBubble({ word: tap.word, sentence: sentenceAt(p, tap.start), lang: shownRef.current.lang, x: tap.x, y: tap.y, para: tap.para });
  }, []);
  const onParaLayout = useCallback((k: number, e: { nativeEvent: { layout: { y: number; height: number } } }) => {
    paraLayout.current[k] = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height };
  }, []);
  const readFrom = (para: number) => {
    setBubble(null);
    if (!shown) return;
    setAutoRun(false);
    if (highlightOn) narrateFrom(para);
    else startNarration(id, i, shown, shownLang, para);
  };
  const paraStyle = useMemo(
    () => ({
      ...(font.regular ? { fontFamily: font.regular } : null),
      color: theme.text,
      fontSize: settings.fontSize,
      lineHeight: Math.round(settings.fontSize * settings.lineHeight),
      marginBottom: Math.round(settings.fontSize * 0.75),
    }),
    [font.regular, theme.text, settings.fontSize, settings.lineHeight],
  );
  const centerStyle = useMemo(() => ({ ...paraStyle, textAlign: 'center' as const }), [paraStyle]);

  const chooseVoice = (voiceId: string, lang: 'tr' | 'en') => {
    setSettings(lang === 'tr' ? { ttsVoiceTr: voiceId } : { ttsVoiceEn: voiceId });
    setShowVoices(false);
    if (narrActive && narr.lang === lang) restartNarration();
  };

  // Return to where this chapter was left, once its final text is laid out.
  // Scroll events before that (layout, font loading) must not overwrite the saved spot.
  const settledRef = useRef(false);
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Opened from a search result: go to that paragraph instead of the saved spot.
  const jumpPara = useRef<number | null>(null);
  const jumpTries = useRef(0);
  const tryRestore = () => {
    if (restoreTo.current === null || !settledRef.current) return;
    if (restoreTimer.current) clearTimeout(restoreTimer.current);
    restoreTimer.current = setTimeout(() => {
      const target = restoreTo.current;
      const { content, view } = sizes.current;
      if (target === null || view <= 0) return;
      const jp = jumpPara.current !== null ? paraLayout.current[jumpPara.current] : undefined;
      if (jumpPara.current !== null && !jp && jumpTries.current++ < 20) {
        // The paragraph is not laid out yet: look again shortly.
        restoreTimer.current = null;
        tryRestore();
        return;
      }
      // Scroll events are ignored while restoring, so record where the text now is:
      // auto-scroll carries on from scrollY and must not use the previous chapter's spot.
      let y = 0;
      if (jp) {
        jumpPara.current = null;
        router.setParams({ para: undefined });
        y = Math.max(0, jp.y - view * 0.25);
      } else if (content > view && target > 0) y = target * (content - view);
      scroll.current?.scrollTo({ y, animated: false });
      scrollY.current = y;
      restoreTo.current = null;
    }, 150);
  };
  useEffect(() => {
    settledRef.current = textSettled;
    if (textSettled) tryRestore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textSettled, shown]);
  useEffect(() => {
    const k = para !== undefined ? parseInt(para, 10) : NaN;
    if (Number.isFinite(k)) {
      jumpPara.current = k;
      jumpTries.current = 0;
      restoreTo.current = restoreTo.current ?? 0;
      tryRestore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [para, i]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (restoreTo.current !== null) return;
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const range = contentSize.height - layoutMeasurement.height;
    position.current = range > 0 ? Math.min(1, Math.max(0, contentOffset.y / range)) : 0;
    const dy = contentOffset.y - scrollY.current;
    scrollY.current = contentOffset.y;
    if (dragging.current && dy !== 0) {
      const off = Math.min(BAR_H, Math.max(0, barOff.current + dy), Math.max(0, contentOffset.y));
      if (off !== barOff.current) {
        barOff.current = off;
        barY.setValue(-off);
      }
    }
    const p = Math.round(position.current * 100);
    if (p !== pct || scrollPct.index !== i) setScrollPct({ index: i, pct: p });
    if (!saveTimer.current) saveTimer.current = setTimeout(save, SAVE_EVERY_MS);
  };

  const total = book?.chapters.length ?? 0;
  const has = (k: number) => !!book?.downloaded.includes(k);
  const go = (k: number) => {
    save();
    snapBar(0);
    restoreTo.current = 0;
    scrollY.current = 0;
    router.setParams({ index: String(k) });
  };
  // ---- auto-scroll: the text moves on by itself at the chosen speed ----
  const autoSpeed = Math.min(AUTO_MAX, Math.max(1, settings.autoScrollSpeed ?? 4));
  const setAutoSpeed = (v: number) => setSettings({ autoScrollSpeed: Math.min(AUTO_MAX, Math.max(1, v)) });
  const narrPlaying = narr.bookId === id && (narr.status === 'playing' || narr.status === 'loading');
  const startAuto = () => {
    if (narrPlaying) pauseNarration();
    setShowSettings(false);
    setAutoOn(true);
    setAutoRun(true);
  };
  const stopAuto = () => {
    setAutoOn(false);
    setAutoRun(false);
  };
  useEffect(() => {
    if (!autoOn) return;
    activateKeepAwakeAsync('autoscroll').catch(() => undefined);
    return () => {
      deactivateKeepAwake('autoscroll').catch(() => undefined);
    };
  }, [autoOn]);
  // Listening moves the text itself, so auto-scroll waits while it plays.
  const autoMoving = autoRun && !narrPlaying;
  useEffect(() => {
    if (!autoMoving) return;
    snapBar(BAR_H);
    let alive = true;
    let frame = 0;
    let last = 0;
    let y = scrollY.current;
    let nextTimer: ReturnType<typeof setTimeout> | null = null;
    const pxPerSec = autoSpeed * AUTO_PX;
    const step = (t: number) => {
      if (!alive) return;
      if (dragging.current || restoreTo.current !== null || !settledRef.current) {
        // The finger (or a chapter change) moved the text: carry on from where it is now.
        y = scrollY.current;
      } else if (last) {
        const max = sizes.current.content - sizes.current.view;
        y += pxPerSec * Math.min(0.1, (t - last) / 1000);
        if (max > 0 && y >= max) {
          scroll.current?.scrollTo({ y: max, animated: false });
          // End of the chapter: on to the next one if it is here, otherwise stop.
          if (book?.downloaded.includes(i + 1)) nextTimer = setTimeout(() => alive && go(i + 1), 1500);
          else setAutoRun(false);
          return;
        }
        scroll.current?.scrollTo({ y, animated: false });
      }
      last = t;
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      if (nextTimer) clearTimeout(nextTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoMoving, autoSpeed, i]);

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

  const slots = useMemo(
    () =>
      illustrate && pictures.index === i && pictures.script && shown ? panelSlots(pictures.script, shown.paragraphs.length) : new Map<number, number[]>(),
    [illustrate, pictures, i, shown],
  );

  const translateBox = chapter && !isTranslated && (
    <View style={{ gap: 6, marginTop: 4, marginBottom: 14 }}>
        {settings.hasGeminiKey ? (
          <Button
            small
            variant="secondary"
            title={downloading ? (download?.translating ? 'Çeviri sürüyor…' : 'İndirme sürüyor…') : 'Bu bölümü Türkçeye çevir'}
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
  );

  const changeFont = (delta: number) =>
    setSettings({ fontSize: Math.min(30, Math.max(13, settings.fontSize + delta)) });

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Stack.Screen options={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }} />

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

      <View style={{ flex: 1, overflow: 'hidden' }}>
        <ScrollView
          ref={scroll}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onScrollBeginDrag={() => {
            userScrollAt.current = Date.now();
            dragging.current = true;
          }}
          onScrollEndDrag={() => {
            userScrollAt.current = Date.now();
            endDrag();
          }}
          onMomentumScrollBegin={() => {
            if (endTimer.current) clearTimeout(endTimer.current);
            endTimer.current = null;
            dragging.current = true;
          }}
          onMomentumScrollEnd={() => {
            userScrollAt.current = Date.now();
            dragging.current = false;
            settleBar();
          }}
          onLayout={(e) => {
            sizes.current.view = e.nativeEvent.layout.height;
            tryRestore();
          }}
          onContentSizeChange={(_w, h) => {
            sizes.current.content = h;
            tryRestore();
          }}
          contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 16 + BAR_H, paddingBottom: 28 }}
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
          {translateBox}
          {illustrate && (comicJob?.running || !!comicJob?.error) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <Text style={{ flex: 1, color: comicJob?.error ? colors.danger : theme.muted, fontSize: 13 }} numberOfLines={2}>
                {comicJob?.error
                  ? `Resimler: ${comicJob.error}`
                  : `Resimler: ${comicJob?.message ?? ''}${comicJob?.total ? ` · ${comicJob.done}/${comicJob.total}` : ''}`}
              </Text>
              {comicJob?.running ? (
                <Pressable onPress={stopComics} hitSlop={8}>
                  <Text style={{ color: theme.muted, fontSize: 13, fontWeight: '700' }}>Durdur</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => ensureComic(id, i)} hitSlop={8}>
                  <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '700' }}>Tekrar dene</Text>
                </Pressable>
              )}
            </View>
          )}
          {shown?.paragraphs.map((p, k) => (
            <Fragment key={k}>
              <ReaderParagraph
                index={k}
                text={p}
                style={/^[*\s~=\-–—•·]{3,}$/.test(p) ? centerStyle : paraStyle}
                hlStart={highlightOn && narr.para === k ? narr.start : -1}
                hlEnd={highlightOn && narr.para === k ? narr.end : -1}
                hlColor={colors.accent + '66'}
                onWord={onWord}
                onLayout={onParaLayout}
              />
              {slots.get(k)?.map((n) => (
                <InlinePicture
                  key={`pic${n}`}
                  uri={panelFile(id, i, n).exists ? panelFile(id, i, n).uri : null}
                  width={winW - 44}
                  version={comicV}
                  waiting={!!comicJob?.running}
                  border={theme.muted + '66'}
                  onLongPress={() => pictureMenu(n)}
                />
              ))}
            </Fragment>
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

          {translateBox}

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
        {autoOn && (
          <View style={[styles.autoPill, { backgroundColor: theme.bg, borderColor: theme.muted + '88' }]}>
            <Pressable
              onPress={() => (autoRun ? setAutoRun(false) : startAuto())}
              hitSlop={8}
              style={styles.autoBtn}
              accessibilityLabel={autoRun ? 'Kaydırmayı duraklat' : 'Kaydırmayı sürdür'}
            >
              <Image source={autoRun ? PAUSE_ICON : PLAY_ICON} style={{ width: 18, height: 18, tintColor: theme.text }} />
            </Pressable>
            <Pressable onPress={() => setAutoSpeed(autoSpeed - 1)} hitSlop={8} style={styles.autoBtn} accessibilityLabel="Yavaşlat">
              <Text style={[styles.autoText, { color: theme.text }]}>−</Text>
            </Pressable>
            <Text style={{ color: theme.muted, fontSize: 13, minWidth: 22, textAlign: 'center' }}>{autoSpeed}</Text>
            <Pressable onPress={() => setAutoSpeed(autoSpeed + 1)} hitSlop={8} style={styles.autoBtn} accessibilityLabel="Hızlandır">
              <Text style={[styles.autoText, { color: theme.text }]}>+</Text>
            </Pressable>
            <Pressable onPress={stopAuto} hitSlop={8} style={styles.autoBtn} accessibilityLabel="Otomatik kaydırmayı kapat">
              <Text style={[styles.autoText, { color: theme.text, fontSize: 16 }]}>✕</Text>
            </Pressable>
          </View>
        )}
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            transform: [{ translateY: showSettings ? 0 : barY }],
          }}
        >
          <Animated.View
            style={[
              styles.bar,
              { backgroundColor: theme.bg, borderColor: theme.muted + '44' },
              !showSettings && { opacity: barY.interpolate({ inputRange: [-BAR_H, 0], outputRange: [0, 1], extrapolate: 'clamp' }) },
            ]}
          >
            <Pressable onPress={() => router.back()} hitSlop={10} style={{ paddingHorizontal: 8 }} accessibilityLabel="Geri">
              <Image source={BACK_ICON} style={{ width: 22, height: 22, tintColor: theme.text }} />
            </Pressable>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700', flex: 1, marginLeft: 6 }} numberOfLines={1}>
              {total ? `${i + 1} / ${total}` : ''}
            </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Pressable
                  onPress={toggleIllustrate}
                  hitSlop={10}
                  style={{ paddingHorizontal: 6, opacity: illustrate ? 1 : 0.45 }}
                  accessibilityLabel={illustrate ? 'Resimleri kapat' : 'Resimleri aç'}
                >
                  <Image source={COMIC_ICON} style={{ width: 24, height: 24, tintColor: illustrate ? colors.accent : theme.text }} />
                </Pressable>
                <Pressable onPress={() => setShowChapters(true)} hitSlop={10} style={{ paddingHorizontal: 8 }} accessibilityLabel="Bölümler">
                  <Image source={ICONS.chapters} style={{ width: 22, height: 22, tintColor: theme.text }} resizeMode="contain" />
                </Pressable>
                <Pressable onPress={listen} hitSlop={10} style={{ paddingHorizontal: 8 }} accessibilityLabel="Sesli oku">
                  {highlightOn && narr.status !== 'paused' ? (
                    <Image source={PAUSE_ICON} style={{ width: 22, height: 22, tintColor: theme.text }} />
                  ) : (
                    <Image source={LISTEN_ICON} style={{ width: 26, height: 26, tintColor: theme.text }} />
                  )}
                </Pressable>
                <Pressable onPress={() => setShowSettings((v) => !v)} hitSlop={10} style={{ paddingHorizontal: 8 }}>
                  <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>Aa</Text>
                </Pressable>
              </View>
          </Animated.View>
          {showSettings && (
            <ScrollView
              style={[styles.panel, { backgroundColor: theme.bg, borderColor: theme.muted, maxHeight: winH * 0.65 }]}
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
                <Text style={[styles.panelLabel, { color: theme.text }]}>Otomatik kaydır</Text>
                <Button small variant="secondary" title="−" onPress={() => setAutoSpeed(autoSpeed - 1)} />
                <Text style={{ color: theme.text, width: 32, textAlign: 'center' }}>{autoSpeed}</Text>
                <Button small variant="secondary" title="+" onPress={() => setAutoSpeed(autoSpeed + 1)} />
                <Button small title={autoOn ? 'Durdur' : 'Başlat'} onPress={autoOn ? stopAuto : startAuto} />
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
        </Animated.View>
      </View>

      {book && (
        <ChapterSheet
          visible={showChapters}
          book={book}
          current={i}
          onClose={() => setShowChapters(false)}
          onOpen={(k) => {
            if (has(k)) {
              setShowChapters(false);
              if (k !== i) go(k);
              return;
            }
            Alert.alert(`${k + 1}. bölüm indirilmemiş`, 'Şimdi indirilsin mi?', [
              { text: 'Vazgeç', style: 'cancel' },
              { text: 'İndir', onPress: () => startDownload(id, [k], { translate: settings.autoTranslate }).catch(() => undefined) },
            ]);
          }}
          footer={
            <View style={{ padding: 12, flexDirection: 'row', gap: 8 }}>
              <Button
                variant="secondary"
                title="Defter"
                icon={ICONS.notebook}
                style={{ flex: 1 }}
                onPress={() => {
                  setShowChapters(false);
                  router.push({ pathname: '/notebook/[id]', params: { id } });
                }}
              />
              <Button
                variant="secondary"
                title="İstatistik"
                icon={ICONS.stats}
                style={{ flex: 1 }}
                onPress={() => {
                  setShowChapters(false);
                  save();
                  router.push({ pathname: '/stats/[id]', params: { id } });
                }}
              />
            </View>
          }
        />
      )}

      {!!chapter && (
        <View style={[styles.progress, { borderColor: theme.muted + '55', paddingBottom: narrActive || narr.message ? 4 : 4 + insets.bottom }]}>
          <View style={[styles.progressTrack, { backgroundColor: theme.muted + '33' }]}>
            <View style={[styles.progressFill, { width: `${pct}%` }]} />
          </View>
          <Text style={[styles.progressText, { color: theme.muted }]} numberOfLines={1}>
            %{pct}
            {shownWords ? ` · ${formatCount(pct >= FINISHED_AT * 100 ? shownWords : (shownWords * pct) / 100)} / ${formatCount(shownWords)} kelime` : ''}
          </Text>
        </View>
      )}

      <WordBubble
        target={bubble}
        palette={BUBBLE[settings.theme]}
        onClose={() => setBubble(null)}
        onReadHere={bubble ? () => readFrom(bubble.para) : undefined}
        source={{ bookId: id, bookTitle: book?.title, chapter: i }}
      />

      {(narrActive || (narr.bookId === id && !!narr.message)) && (
        <View style={[styles.player, { backgroundColor: theme.bg, borderColor: theme.muted, paddingBottom: 8 + insets.bottom }]}>
          {!!narr.message && (
            <Text style={{ color: narr.status === 'error' ? colors.danger : theme.muted, fontSize: 13 }}>{narr.message}</Text>
          )}
          {narrActive && (
            <View style={styles.playerRow}>
              <Pressable onPress={() => skipParagraph(-1)} hitSlop={8} style={styles.playerBtn}>
                <Image source={PREV_ICON} style={[styles.playerImg, { tintColor: theme.text }]} />
              </Pressable>
              <Pressable
                onPress={() => (narr.status === 'playing' || narr.status === 'loading' ? pauseNarration() : resumeNarration())}
                hitSlop={8}
                style={[styles.playerBtn, styles.playerMain]}
              >
                <Image
                  source={narr.status === 'playing' || narr.status === 'loading' ? PAUSE_ICON : PLAY_ICON}
                  style={[styles.playerImg, { tintColor: colors.accentText }]}
                />
              </Pressable>
              <Pressable onPress={() => skipParagraph(1)} hitSlop={8} style={styles.playerBtn}>
                <Image source={NEXT_ICON} style={[styles.playerImg, { tintColor: theme.text }]} />
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
  bar: {
    height: BAR_H,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  autoPill: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    opacity: 0.92,
  },
  autoBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  autoText: { fontSize: 20, fontWeight: '700' },
  panel: { padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, flexGrow: 0, flexShrink: 0 },
  panelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  panelLabel: { width: 100, fontSize: 14 },
  select: { flex: 1, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
  sheet: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 12, maxHeight: '75%' },
  sheetTitle: { fontSize: 16, fontWeight: '700', paddingHorizontal: 16, paddingBottom: 8 },
  fontRow: { paddingHorizontal: 16, paddingVertical: 10, gap: 2 },
  progress: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 4, gap: 3 },
  progressTrack: { height: 3, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 3, backgroundColor: colors.accent },
  progressText: { fontSize: 11, textAlign: 'right' },
  player: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 8, gap: 6 },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playerBtn: { minWidth: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  playerMain: { backgroundColor: colors.accent, width: 48, height: 48, borderRadius: 24 },
  playerIcon: { fontSize: 20 },
  playerImg: { width: 22, height: 22 },
  swatch: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 2 },
});
