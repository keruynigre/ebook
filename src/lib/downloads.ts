import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSyncExternalStore } from 'react';

import { startForeground, stopForeground, updateForeground } from './foreground';
import { GeminiError, listModels, mergeGlossary, translateChapter } from './gemini';
import { http } from './http';
import { getBook, putBook } from './library';
import { getGeminiKey, getSettings, setSettings } from './settings';
import { sourceById } from './sources';
import { ModelPool } from './modelPool';
import { refreshModelList } from './models';
import { loadNotebook, recordChapterInfo } from './notebook';
import { knownCharacterList } from './notebookCore';
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
/** With one chapter at a time (free tier), keep a small gap between Gemini requests. */
const SINGLE_GAP_MS = 4000;
/** Give up on a chapter after waiting this long for any model to be free. */
const MAX_TRANSLATE_WAIT_MS = 8 * 60 * 1000;

export interface JobOptions {
  /** Translate to Turkish too. Defaults to the "auto translate" setting. */
  translate?: boolean;
}

/**
 * Downloads (and optionally translates) the given chapter indexes.
 * Downloads run one after another; translations run alongside them, several at a
 * time if the settings allow, switching to another Gemini model when one is busy.
 * Finished work is skipped, so an interrupted job can simply be started again.
 */
export async function startDownload(bookId: string, indexes: number[], options: JobOptions = {}): Promise<void> {
  if (states.get(bookId)?.running) return;
  const book = getBook(bookId);
  if (!book) return;

  const settings = getSettings();
  const key = settings.hasGeminiKey ? await getGeminiKey() : null;
  let translate = (options.translate ?? settings.autoTranslate) && !!key && !!settings.geminiModel;
  const concurrency = Math.min(4, Math.max(1, Math.round(settings.translateConcurrency || 1)));

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
  let fallbacks = settings.geminiModels ?? [];
  if (translate && fallbacks.length === 0) {
    // Older installs never saved the model list; fetch it once so fallback works.
    try {
      fallbacks = (await listModels(key!)).map((m) => m.name);
      setSettings({ geminiModels: fallbacks });
    } catch {
      fallbacks = [];
    }
  }
  const pool = new ModelPool(settings.geminiModel, fallbacks);
  const inFlight = new Set<Promise<void>>();

  const show = (phase: string) => {
    state.phase = phase;
    set(bookId, { ...state });
    updateForeground(book.title, `${phase} · ${state.done + state.failed}/${todo.length}`, state.done + state.failed, todo.length);
  };

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

  let lastProblem = '';
  let modelsRefreshed = false;
  const translateOne = async (index: number, content: ChapterContent): Promise<void> => {
    const startedAt = Date.now();
    let otherErrors = 0;
    for (;;) {
      if (cancelled.has(bookId)) throw new GeminiError('Durduruldu.', 'other');
      let choice = pool.pick();
      if (!choice && !modelsRefreshed) {
        // Every known model failed: maybe Google retired them. Ask for the current list once.
        modelsRefreshed = true;
        show('Gemini model listesi yenileniyor');
        pool.addModels(await refreshModelList(key!).catch(() => []));
        choice = pool.pick();
      }
      if (!choice) {
        throw new GeminiError(
          `Kullanılabilecek Gemini modeli kalmadı (günlük hak dolmuş ya da model bu isteği desteklemiyor).${lastProblem ? ` Son hata: ${lastProblem}` : ''}`,
          'daily',
        );
      }
      if ('waitMs' in choice) {
        if (Date.now() - startedAt > MAX_TRANSLATE_WAIT_MS) {
          throw new GeminiError('Gemini modellerinin hepsi uzun süredir yoğun. Biraz sonra tekrar deneyin.', 'busy');
        }
        show(`Gemini yoğun, ${Math.ceil(choice.waitMs / 1000)} sn bekleniyor`);
        await sleep(Math.min(choice.waitMs, 15_000));
        continue;
      }
      const model = choice.model;
      if (concurrency === 1) {
        const wait = lastGemini + SINGLE_GAP_MS - Date.now();
        if (wait > 0) await sleep(wait);
      }
      lastGemini = Date.now();
      try {
        show(`Çevriliyor (${ModelPool.label(model)})`);
        const known = knownCharacterList(await loadNotebook(bookId).catch(() => ({ characters: [], summaries: {} })));
        const r = await translateChapter(key!, model, content, glossary, book.title, settings.translationPrompt, known);
        await saveTranslation(bookId, index, r.chapter);
        recordChapterInfo(bookId, index, r.info).catch(() => undefined);
        if (r.newTerms.length) {
          glossary = mergeGlossary(glossary, r.newTerms);
          await saveGlossary(bookId, glossary);
        }
        return;
      } catch (e) {
        if (!(e instanceof GeminiError)) throw e;
        lastProblem = `${ModelPool.label(model)}: ${e.message}`;
        if (e.kind === 'busy' || e.kind === 'rate' || e.kind === 'daily') {
          pool.report(model, e.kind, e.retryAfterMs);
          continue;
        }
        if (e.kind === 'unsupported') {
          // This model can't do the job at all; use the others.
          pool.report(model, 'daily');
          continue;
        }
        if (e.kind === 'other' && ++otherErrors < 2) continue;
        throw e;
      }
    }
  };

  const startTranslation = (index: number, content: ChapterContent) => {
    const task = (async () => {
      try {
        await translateOne(index, content);
        haveTr.add(index);
        state.translated++;
      } catch (e) {
        const err = e as GeminiError;
        if (err.kind === 'daily' || err.kind === 'auth' || err.kind === 'busy') {
          // Stop translating; downloads go on and translation can be resumed later.
          translate = false;
          state.translating = false;
          state.translateError = err.message;
        } else if (!cancelled.has(bookId)) {
          state.translateError = `${book.chapters[index]?.title}: ${err.message}`;
        }
      }
      state.done++;
      await persist().catch(() => undefined);
      set(bookId, { ...state });
    })();
    inFlight.add(task);
    task.finally(() => inFlight.delete(task));
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
        show('İndiriliyor');
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
        if (n < todo.length - 1) await sleep(DELAY_MS + Math.random() * JITTER_MS);
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

      // 2) Translate alongside the next downloads, if asked and not done yet.
      if (translate && !haveTr.has(index)) {
        while (inFlight.size >= concurrency) await Promise.race(inFlight);
        if (translate && !cancelled.has(bookId)) {
          startTranslation(index, content);
          continue;
        }
      }

      state.done++;
      await persist();
      set(bookId, { ...state });
    }
    while (inFlight.size > 0) await Promise.race(inFlight);
  } finally {
    while (inFlight.size > 0) await Promise.race(inFlight).catch(() => undefined);
    await persist().catch(() => undefined);
    deactivateKeepAwake(tag).catch(() => undefined);
    stopForeground();
    set(bookId, { ...state, running: false, current: undefined, phase: undefined, finishedAt: Date.now() });
  }
}
