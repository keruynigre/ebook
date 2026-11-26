/**
 * Story notebook per book: characters, chapter summaries (and the glossary,
 * which lives in glossary.json). Filled while translating, or on demand for
 * chapters read earlier ("Güncelle"), never beyond the chapter asked for.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';

import { GeminiError, analyzeChapters } from './gemini';
import { getBook } from './library';
import { ModelPool } from './modelPool';
import { refreshModelList } from './models';
import { autoChapters, chapterNeedsWork, chaptersWithCast, clearChapterNotes, dropTurkishNames, emptyNotebook, mergeChapterInfo, type ChapterInfo, type Notebook } from './notebookCore';
import { getGeminiKey, getSettings } from './settings';
import { loadChapter, loadNotebookFile, loadTranslation, saveNotebookFile } from './storage';

export type { Notebook } from './notebookCore';

const cache = new Map<string, Notebook>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  for (const l of listeners) l();
};
// Writes for a book run one after another so parallel translations don't lose updates.
const queues = new Map<string, Promise<unknown>>();

export async function loadNotebook(bookId: string): Promise<Notebook> {
  const hit = cache.get(bookId);
  if (hit) return hit;
  const raw = (await loadNotebookFile(bookId)) as Notebook | null;
  const nb = raw && Array.isArray(raw.characters) && raw.summaries ? dropTurkishNames(raw) : emptyNotebook();
  cache.set(bookId, nb);
  if (raw && nb !== raw) await saveNotebookFile(bookId, nb);
  return nb;
}

function update(bookId: string, change: (nb: Notebook) => Notebook): Promise<void> {
  const prev = queues.get(bookId) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      const nb = change(await loadNotebook(bookId));
      cache.set(bookId, nb);
      await saveNotebookFile(bookId, nb);
      emit();
    });
  queues.set(bookId, next);
  return next;
}

export function recordChapterInfo(bookId: string, chapter: number, info: ChapterInfo): Promise<void> {
  if (!info.summary && !info.characters.length) return Promise.resolve();
  return update(bookId, (nb) => mergeChapterInfo(nb, chapter, info));
}

export function editNotebook(bookId: string, change: (nb: Notebook) => Notebook): Promise<void> {
  return update(bookId, change);
}

/** The notebook of a book, re-rendering when it changes. */
export function useNotebook(bookId: string): Notebook | null {
  const v = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  const [nb, setNb] = useState<Notebook | null>(() => cache.get(bookId) ?? null);
  useEffect(() => {
    let alive = true;
    loadNotebook(bookId).then((x) => alive && setNb(x));
    return () => {
      alive = false;
    };
  }, [bookId, v]);
  return nb;
}

// ---- filling in chapters read earlier -------------------------------------

export interface NotebookJob {
  running: boolean;
  done: number;
  total: number;
  message: string;
  error?: string;
}

const jobs = new Map<string, NotebookJob>();
const stopRequested = new Set<string>();
const setJob = (id: string, j: NotebookJob) => {
  jobs.set(id, j);
  emit();
};

export function useNotebookJob(bookId: string): NotebookJob | undefined {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  return jobs.get(bookId);
}

/** Downloaded chapters up to `upTo` (inclusive) with no notes yet, or none in the reader's language. */
export function missingChapters(bookId: string, nb: Notebook, upTo: number, lang: 'tr' | 'en'): number[] {
  const book = getBook(bookId);
  if (!book) return [];
  const withCast = chaptersWithCast(nb);
  return book.downloaded.filter((i) => i <= upTo && chapterNeedsWork(nb, i, lang, withCast)).sort((a, b) => a - b);
}

const BATCH_CHARS = 28_000;
const BATCH_MAX = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function stopNotebookJob(bookId: string) {
  stopRequested.add(bookId);
}

/**
 * Called by the reader on a new chapter: fills in the few chapters the notebook lacks,
 * but only when it follows the story from the start (see autoChapters).
 */
export async function autoFillNotebook(bookId: string, upTo: number, lang: 'tr' | 'en'): Promise<void> {
  if (jobs.get(bookId)?.running) return;
  const book = getBook(bookId);
  const settings = getSettings();
  if (!book || !settings.geminiModel || !(await getGeminiKey())) return;
  const nb = await loadNotebook(bookId);
  // The chapter on screen: its own translation adds the notes when it is being translated.
  const todo = autoChapters(nb, missingChapters(bookId, nb, upTo, lang), upTo).filter(
    (i) => i < upTo || lang === 'en' || book.translated?.includes(i),
  );
  if (todo.length) await fillNotebook(bookId, upTo, lang, todo);
}

export async function fillNotebook(bookId: string, upTo: number, lang: 'tr' | 'en', only?: number[]): Promise<void> {
  if (jobs.get(bookId)?.running) return;
  stopRequested.delete(bookId);
  const book = getBook(bookId);
  const key = await getGeminiKey();
  const settings = getSettings();
  if (!book || !key || !settings.geminiModel) {
    setJob(bookId, {
      running: false,
      done: 0,
      total: 0,
      message: '',
      error: 'Önce Ayarlar’dan Gemini anahtarı girin.',
    });
    return;
  }
  const todo = only ?? missingChapters(bookId, await loadNotebook(bookId), upTo, lang);
  const job: NotebookJob = {
    running: true,
    done: 0,
    total: todo.length,
    message: 'Hazırlanıyor…',
  };
  setJob(bookId, { ...job });
  const pool = new ModelPool(settings.geminiModel, settings.geminiModels ?? []);
  let at = 0;
  let modelsRefreshed = false;
  // Fewer chapters per request after an unreadable (often cut-off) answer.
  let batchMax = BATCH_MAX;
  let failures = 0;
  let skipped = 0;
  try {
    while (at < todo.length) {
      if (stopRequested.has(bookId)) throw new Error('Durduruldu.');
      // Next batch: a few chapters, Turkish text when there is one.
      const batch: { index: number; title: string; paragraphs: string[] }[] = [];
      let chars = 0;
      while (at + batch.length < todo.length && batch.length < batchMax) {
        const i = todo[at + batch.length];
        const c = (book.translated?.includes(i) ? await loadTranslation(bookId, i) : null) ?? (await loadChapter(bookId, i));
        if (!c) {
          batch.push({ index: i, title: '', paragraphs: [] });
          continue;
        }
        const len = c.paragraphs.reduce((n, p) => n + p.length, 0);
        if (batch.length && chars + len > BATCH_CHARS) break;
        chars += len;
        batch.push({ index: i, title: c.title, paragraphs: c.paragraphs });
      }
      const usable = batch.filter((b) => b.paragraphs.length);
      let results: { index: number; info: ChapterInfo }[] = [];
      let unreadable = false;
      for (;;) {
        if (stopRequested.has(bookId)) throw new Error('Durduruldu.');
        let choice = pool.pick();
        if (!choice && !modelsRefreshed) {
          modelsRefreshed = true;
          setJob(bookId, {
            ...job,
            message: 'Gemini model listesi yenileniyor',
          });
          pool.addModels(await refreshModelList(key).catch(() => []));
          choice = pool.pick();
        }
        if (!choice) throw new Error('Gemini’nin bugünkü kullanım hakkı doldu. Yarın kaldığı yerden devam edebilirsiniz.');
        if ('waitMs' in choice) {
          setJob(bookId, {
            ...job,
            message: `Gemini yoğun, ${Math.ceil(choice.waitMs / 1000)} sn bekleniyor`,
          });
          await sleep(Math.min(choice.waitMs, 15_000));
          continue;
        }
        try {
          setJob(bookId, {
            ...job,
            message: `${usable[0]?.index + 1}–${usable[usable.length - 1]?.index + 1}. bölümler okunuyor`,
          });
          const nb = await loadNotebook(bookId);
          results = usable.length
            ? await analyzeChapters(
                key,
                choice.model,
                usable,
                nb.characters.map((c) => c.name),
                book.title,
              )
            : [];
          break;
        } catch (e) {
          if (!(e instanceof GeminiError)) throw e;
          if (e.kind === 'busy' || e.kind === 'rate' || e.kind === 'daily') pool.report(choice.model, e.kind, e.retryAfterMs);
          else if (e.kind === 'unsupported') pool.report(choice.model, 'daily');
          else if (e.kind === 'other' || e.kind === 'blocked') {
            unreadable = true;
            break;
          } else throw e;
        }
      }
      if (unreadable) {
        failures++;
        if (batch.length > 1) {
          // Try again with half as many chapters.
          batchMax = Math.max(1, Math.floor(batch.length / 2));
          continue;
        }
        if (failures < 3) continue;
        // One chapter keeps failing: leave it for later and go on.
        skipped++;
        failures = 0;
        at += batch.length;
        job.done = at;
        setJob(bookId, { ...job });
        continue;
      }
      failures = 0;
      for (const r of results.sort((a, b) => a.index - b.index)) {
        // An empty summary still marks the chapter as done.
        await update(bookId, (nb) =>
          mergeChapterInfo(clearChapterNotes(nb, r.index), r.index, {
            ...r.info,
            summary: r.info.summary || '—',
          }),
        );
      }
      at += batch.length;
      job.done = at;
      setJob(bookId, { ...job });
      await sleep(4_000); // stay under the free tier's per-minute limit
    }
    setJob(bookId, {
      running: false,
      done: job.done,
      total: job.total,
      message: skipped
        ? `${job.done - skipped} bölüm deftere işlendi, ${skipped} bölüm işlenemedi (sonra tekrar “Güncelle”).`
        : `${job.done} bölüm deftere işlendi.`,
    });
  } catch (e) {
    setJob(bookId, {
      running: false,
      done: job.done,
      total: job.total,
      message: '',
      error: (e as Error).message,
    });
  }
}
