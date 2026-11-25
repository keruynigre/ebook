import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSyncExternalStore } from 'react';

import { startForeground, stopForeground, updateForeground } from './foreground';
import { GeminiError, mergeGlossary, translateChapter } from './gemini';
import { http } from './http';
import { getBook, putBook } from './library';
import { getGeminiKey, getSettings } from './settings';
import { sourceById } from './sources';
import { loadChapter, loadGlossary, saveChapter, saveGlossary, saveTranslation } from './storage';
import { sleep } from './text';
import type { ChapterContent } from './types';

export interface DownloadState {
  running: boolean;
  /** Chapters this job works on. */
  total: number;
  /** Chapters finished (downloaded, and translated if asked). */
  done: number;
  failed: number;
  /** Whether this job also translates. */
  translating: boolean;
  translated: number;
  current?: string;
  /** What is happening right now, e.g. "İndiriliyor" or "Çevriliyor". */
  phase?: string;
  error?: string;
  /** Translation stopped (e.g. daily limit) while downloading continued. */
  translateError?: string;
  finishedAt?: number;
}

const states = new Map<string, DownloadState>();
const cancelled = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function set(id: string, s: DownloadState) {
  states.set(id, s);
  version++;
  for (const l of listeners) l();
}

export function useDownload(id: string): DownloadState | undefined {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  return states.get(id);
}

export function cancelDownload(id: string) {
  cancelled.add(id);
}

/** Polite pause between requests so the site is not hammered. */
const DELAY_MS = 1200;
const JITTER_MS = 800;
const RETRIES = 3;
const MAX_CONSECUTIVE_FAILURES = 4;
/** Gemini's free tier allows only a few requests a minute. */
const MIN_TRANSLATE_GAP_MS = 6000;
const RATE_RETRIES = 6;

export interface JobOptions {
  /** Translate to Turkish too. Defaults to the "auto translate" setting. */
  translate?: boolean;
}

/**
 * Downloads (and optionally translates) the given chapter indexes one after another.
 * Finished work is skipped, so an interrupted job can simply be started again.
 */
export async function startDownload(bookId: string, indexes: number[], options: JobOptions = {}): Promise<void> {
  if (states.get(bookId)?.running) return;
  const book = getBook(bookId);
  if (!book) return;

  const settings = getSettings();
  const key = settings.hasGeminiKey ? await getGeminiKey() : null;
  let translate = (options.translate ?? settings.autoTranslate) && !!key && !!settings.geminiModel;

  const have = new Set(book.downloaded);
  const haveTr = new Set(book.translated ?? []);
  const todo = indexes.filter(
    (i) => i >= 0 && i < book.chapters.length && (!have.has(i) || (translate && !haveTr.has(i))),
  );
  cancelled.delete(bookId);
  const state: DownloadState = { running: true, total: todo.length, done: 0, failed: 0, translating: translate, translated: 0 };
  set(bookId, { ...state });
  if (todo.length === 0) {
    set(bookId, { ...state, running: false, finishedAt: Date.now() });
    return;
  }

  const source = sourceById(book.sourceId);
  const tag = `download-${bookId}`;
  await activateKeepAwakeAsync(tag).catch(() => undefined);
  // Keeps the job alive while the app is in the background or the screen is off.
  await startForeground(book.title, `0 / ${todo.length} bölüm`).catch(() => undefined);
  let consecutive = 0;
  let lastGemini = 0;
  let glossary = translate ? await loadGlossary(bookId) : [];

  const persist = async () => {
    const latest = getBook(bookId);
    if (!latest) return;
    const downloaded = new Set([...latest.downloaded, ...have]);
    const translated = new Set([...(latest.translated ?? []), ...haveTr]);
    await putBook({
      ...latest,
      downloaded: [...downloaded].sort((a, b) => a - b),
      translated: [...translated].sort((a, b) => a - b),
      updatedAt: Date.now(),
    });
  };

  const translateOne = async (index: number, content: ChapterContent): Promise<void> => {
    for (let attempt = 0; ; attempt++) {
      const wait = lastGemini + MIN_TRANSLATE_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastGemini = Date.now();
      try {
        const r = await translateChapter(key!, settings.geminiModel, content, glossary, book.title);
        await saveTranslation(bookId, index, r.chapter);
        if (r.newTerms.length) {
          glossary = mergeGlossary(glossary, r.newTerms);
          await saveGlossary(bookId, glossary);
        }
        return;
      } catch (e) {
        if (e instanceof GeminiError && e.kind === 'rate' && attempt < RATE_RETRIES) {
          state.phase = 'Gemini sınırı, bekleniyor';
          set(bookId, { ...state });
          await sleep(Math.min(90_000, e.retryAfterMs ?? 20_000 * (attempt + 1)));
          continue;
        }
        if (e instanceof GeminiError && e.kind === 'other' && attempt < 1) continue;
        throw e;
      }
    }
  };

  try {
    for (let n = 0; n < todo.length; n++) {
      if (cancelled.has(bookId)) {
        state.error = 'Durduruldu.';
        break;
      }
      const index = todo[n];
      const ref = book.chapters[index];
      state.current = ref.title;

      // 1) Download, unless already on the device.
      let content: ChapterContent | null = have.has(index) ? await loadChapter(bookId, index) : null;
      let lastError = '';
      if (!content) {
        state.phase = 'İndiriliyor';
        set(bookId, { ...state });
        updateForeground(book.title, `${n + 1} / ${todo.length}: ${ref.title}`, n, todo.length);
        for (let attempt = 0; attempt < RETRIES && !content; attempt++) {
          if (attempt > 0) await sleep(2000 * attempt * attempt);
          try {
            const c = await source.getChapter(ref.url, http);
            content = { title: ref.title || c.title, paragraphs: c.paragraphs };
            await saveChapter(bookId, index, content);
            have.add(index);
          } catch (e) {
            lastError = (e as Error).message;
          }
        }
        if (n < todo.length - 1 || translate) await sleep(DELAY_MS + Math.random() * JITTER_MS);
      }

      if (!content) {
        state.failed++;
        if (++consecutive >= MAX_CONSECUTIVE_FAILURES) {
          state.error = `Arka arkaya ${consecutive} bölüm indirilemedi: ${lastError}`;
          break;
        }
        set(bookId, { ...state });
        continue;
      }
      consecutive = 0;

      // 2) Translate, if asked and not done yet.
      if (translate && !haveTr.has(index)) {
        state.phase = 'Çevriliyor';
        set(bookId, { ...state });
        updateForeground(book.title, `Çevriliyor ${n + 1} / ${todo.length}: ${ref.title}`, n, todo.length);
        try {
          await translateOne(index, content);
          haveTr.add(index);
          state.translated++;
        } catch (e) {
          const err = e as GeminiError;
          if (err.kind === 'daily' || err.kind === 'auth') {
            // Keep downloading; translation can be resumed later.
            translate = false;
            state.translating = false;
            state.translateError = err.message;
          } else {
            state.translateError = `${ref.title}: ${err.message}`;
          }
        }
      }

      state.done++;
      await persist();
      set(bookId, { ...state });
    }
  } finally {
    await persist().catch(() => undefined);
    deactivateKeepAwake(tag).catch(() => undefined);
    stopForeground();
    set(bookId, { ...state, running: false, current: undefined, phase: undefined, finishedAt: Date.now() });
  }
}
