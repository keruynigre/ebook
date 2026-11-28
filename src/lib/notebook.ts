/**
 * Story notebook per book: characters, chapter summaries (and the glossary,
 * which lives in glossary.json). Filled while translating, or on demand for
 * chapters read earlier ("Güncelle"), never beyond the chapter asked for.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';

import { GeminiError, analyzeChapters, findSameCharacters, profileCharacters } from './gemini';
import { getBook } from './library';
import { ModelPool } from './modelPool';
import { refreshModelList } from './models';
import { needsProfile, parseProfiles, autoChapters, chapterNeedsWork, knownCharacterList, mergeCharacterGroups, noteText, chaptersWithCast, clearChapterNotes, dropTurkishNames, emptyNotebook, mergeChapterInfo, type ChapterInfo, type Notebook } from './notebookCore';
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
/** Each "Durdur" starts a new run number; work started under an older number stops and stays silent. */
const runs = new Map<string, number>();
const runOf = (id: string) => runs.get(id) ?? 0;
const setJob = (id: string, j: NotebookJob) => {
  jobs.set(id, j);
  emit();
};
/** setJob, unless this work was stopped in the meantime. */
const setRun = (id: string, run: number, j: NotebookJob) => {
  if (runOf(id) === run) setJob(id, j);
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

/** Stops the notebook work at once (what is still on its way is dropped) and frees the buttons. */
export function stopNotebookJob(bookId: string) {
  runs.set(bookId, runOf(bookId) + 1);
  const j = jobs.get(bookId);
  setJob(bookId, { running: false, done: j?.done ?? 0, total: j?.total ?? 0, message: j?.running ? 'Durduruldu.' : (j?.message ?? '') });
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
  const run = runOf(bookId);
  const book = getBook(bookId);
  const key = await getGeminiKey();
  const settings = getSettings();
  if (!book || !key || !settings.geminiModel) {
    setRun(bookId, run, {
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
  setRun(bookId, run, { ...job });
  const pool = new ModelPool(settings.geminiModel, settings.geminiModels ?? []);
  let at = 0;
  let modelsRefreshed = false;
  // Fewer chapters per request after an unreadable (often cut-off) answer.
  let batchMax = BATCH_MAX;
  let failures = 0;
  let skipped = 0;
  try {
    while (at < todo.length) {
      if (runOf(bookId) !== run) throw new Error('Durduruldu.');
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
        if (runOf(bookId) !== run) throw new Error('Durduruldu.');
        let choice = pool.pick();
        if (!choice && !modelsRefreshed) {
          modelsRefreshed = true;
          setRun(bookId, run, {
            ...job,
            message: 'Gemini model listesi yenileniyor',
          });
          pool.addModels(await refreshModelList(key).catch(() => []));
          choice = pool.pick();
        }
        if (!choice) throw new Error('Gemini’nin bugünkü kullanım hakkı doldu. Yarın kaldığı yerden devam edebilirsiniz.');
        if ('waitMs' in choice) {
          setRun(bookId, run, {
            ...job,
            message: `Gemini yoğun, ${Math.ceil(choice.waitMs / 1000)} sn bekleniyor`,
          });
          await sleep(Math.min(choice.waitMs, 15_000));
          continue;
        }
        try {
          setRun(bookId, run, {
            ...job,
            message: `${usable[0]?.index + 1}–${usable[usable.length - 1]?.index + 1}. bölümler okunuyor`,
          });
          const nb = await loadNotebook(bookId);
          results = usable.length
            ? await analyzeChapters(
                key,
                choice.model,
                usable,
                knownCharacterList(nb),
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
        setRun(bookId, run, { ...job });
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
      setRun(bookId, run, { ...job });
      await sleep(4_000); // stay under the free tier's per-minute limit
    }
    await writeProfiles(bookId, upTo, pool, key, (message) => setRun(bookId, run, { ...job, message }), run).catch(() => undefined);
    setRun(bookId, run, {
      running: false,
      done: job.done,
      total: job.total,
      message: skipped
        ? `${job.done - skipped} bölüm deftere işlendi, ${skipped} bölüm işlenemedi (sonra tekrar “Güncelle”).`
        : `${job.done} bölüm deftere işlendi.`,
    });
  } catch (e) {
    setRun(bookId, run, {
      running: false,
      done: job.done,
      total: job.total,
      message: '',
      error: (e as Error).message,
    });
  }
}

/**
 * Asks Gemini which characters are the same person under different names and joins them.
 * Returns how many records were joined away.
 */
export async function joinSameCharacters(bookId: string): Promise<number> {
  if (jobs.get(bookId)?.running) return 0;
  const book = getBook(bookId);
  const key = await getGeminiKey();
  const settings = getSettings();
  if (!book || !key || !settings.geminiModel) throw new Error('Önce Ayarlar’dan Gemini anahtarı girin.');
  const nb = await loadNotebook(bookId);
  if (nb.characters.length < 2) return 0;
  setJob(bookId, { running: true, done: 0, total: 1, message: 'Aynı kişiler aranıyor' });
  try {
    const pool = new ModelPool(settings.geminiModel, settings.geminiModels ?? []);
    const list = nb.characters.slice(0, 400).map((c) => ({ name: c.name, aliases: c.aliases, note: c.notes[0] ? noteText(c.notes[0], 'en') : '' }));
    let groups: string[][] | null = null;
    for (let tries = 0; !groups && tries < 8; tries++) {
      const choice = pool.pick();
      if (!choice) throw new Error('Gemini’nin bugünkü kullanım hakkı doldu.');
      if ('waitMs' in choice) {
        await sleep(Math.min(choice.waitMs, 15_000));
        continue;
      }
      try {
        groups = await findSameCharacters(key, choice.model, list, book.title);
      } catch (e) {
        if (!(e instanceof GeminiError)) throw e;
        if (e.kind === 'busy' || e.kind === 'rate' || e.kind === 'daily') pool.report(choice.model, e.kind, e.retryAfterMs);
        else if (e.kind === 'unsupported') pool.report(choice.model, 'daily');
        else if (e.kind !== 'other') throw e;
      }
    }
    if (!groups) throw new Error('Gemini yanıt vermedi, biraz sonra tekrar deneyin.');
    const before = (await loadNotebook(bookId)).characters.length;
    await update(bookId, (n) => mergeCharacterGroups(n, groups!));
    const joined = before - (await loadNotebook(bookId)).characters.length;
    setJob(bookId, { running: false, done: 1, total: 1, message: joined ? `${joined} tekrar kayıt birleştirildi.` : 'Tekrar eden karakter bulunmadı.' });
    return joined;
  } catch (e) {
    setJob(bookId, { running: false, done: 0, total: 1, message: '', error: (e as Error).message });
    throw e;
  }
}

// ---- short character cards ----------------------------------------------------------

const PROFILE_BATCH = 15;
const PROFILE_MAX = 400;

/** Writes (or renews) the short cards of the most seen characters whose notes have grown. */
async function writeProfiles(bookId: string, upTo: number, pool: ModelPool, key: string, say: (m: string) => void, run = runOf(bookId)): Promise<void> {
  const book = getBook(bookId);
  if (!book) return;
  const todo = (await loadNotebook(bookId)).characters
    .filter((c) => c.firstChapter <= upTo && needsProfile(c, upTo))
    .sort((a, b) => b.seenIn.length - a.seenIn.length)
    .slice(0, PROFILE_MAX);
  for (let at = 0; at < todo.length; at += PROFILE_BATCH) {
    if (runOf(bookId) !== run) return;
    const batch = todo.slice(at, at + PROFILE_BATCH).map((c) => {
      const notes = c.notes.filter((n) => n.chapter <= upTo);
      return {
        c,
        noteCount: notes.length,
        last: Math.max(c.firstChapter, ...notes.map((n) => n.chapter)),
        send: { name: c.name, aliases: c.aliases, notes: notes.map((n) => noteText(n, 'en').slice(0, 220)) },
      };
    });
    say(`Karakter kartları yazılıyor (${Math.min(at + PROFILE_BATCH, todo.length)}/${todo.length})`);
    let data: any = null;
    for (let tries = 0; !data && tries < 6; tries++) {
      if (runOf(bookId) !== run) return;
      const choice = pool.pick();
      if (!choice) return;
      if ('waitMs' in choice) {
        await sleep(Math.min(choice.waitMs, 15_000));
        continue;
      }
      try {
        data = await profileCharacters(key, choice.model, book.title, batch.map((b) => b.send));
      } catch (e) {
        if (!(e instanceof GeminiError)) throw e;
        if (e.kind === 'busy' || e.kind === 'rate' || e.kind === 'daily') pool.report(choice.model, e.kind, e.retryAfterMs);
        else if (e.kind === 'unsupported') pool.report(choice.model, 'daily');
        else if (e.kind !== 'other') throw e;
      }
    }
    if (!data) return;
    if (runOf(bookId) !== run) return;
    const cards = parseProfiles(data);
    await update(bookId, (nb) => ({
      ...nb,
      characters: nb.characters.map((c) => {
        const b = batch.find((x) => x.c.name === c.name);
        const card = b && cards[c.name];
        return card ? { ...c, profile: { ...card, upTo: b.last, noteCount: b.noteCount } } : c;
      }),
    }));
    await sleep(4_000);
  }
}

/** Called when the notebook is opened: renews cards that are missing or behind (no chapters are read). */
export async function refreshProfiles(bookId: string, upTo: number): Promise<void> {
  if (jobs.get(bookId)?.running) return;
  const key = await getGeminiKey();
  const settings = getSettings();
  if (!key || !settings.geminiModel) return;
  const nb = await loadNotebook(bookId);
  if (!nb.characters.some((c) => c.firstChapter <= upTo && needsProfile(c, upTo))) return;
  const run = runOf(bookId);
  const pool = new ModelPool(settings.geminiModel, settings.geminiModels ?? []);
  setRun(bookId, run, { running: true, done: 0, total: 0, message: 'Karakter kartları yazılıyor' });
  try {
    await writeProfiles(bookId, upTo, pool, key, (message) => setRun(bookId, run, { running: true, done: 0, total: 0, message }), run);
    setRun(bookId, run, { running: false, done: 0, total: 0, message: '' });
  } catch (e) {
    setRun(bookId, run, { running: false, done: 0, total: 0, message: '', error: (e as Error).message });
  }
}

/**
 * "Baştan düzenle": joins records of the same person, throws away every short card and writes
 * them again from the notes up to the reading point.
 */
export async function rebuildNotebook(bookId: string, upTo: number): Promise<void> {
  if (jobs.get(bookId)?.running) stopNotebookJob(bookId);
  await joinSameCharacters(bookId).catch(() => 0);
  await update(bookId, (nb) => ({ ...nb, characters: nb.characters.map(({ profile: _drop, ...c }) => c) }));
  await refreshProfiles(bookId, upTo);
  const job = jobs.get(bookId);
  if (job && !job.error) setJob(bookId, { ...job, message: 'Defter baştan düzenlendi.' });
}

/**
 * "Sıfırdan kur": forgets every character and summary and reads the chapters up to the
 * reading point again. Names the reader chose are kept and reused.
 */
export async function resetNotebook(bookId: string, upTo: number, lang: 'tr' | 'en'): Promise<void> {
  if (jobs.get(bookId)?.running) stopNotebookJob(bookId);
  await update(bookId, (nb) => ({
    characters: nb.characters
      .filter((c) => c.pinned)
      .map((c) => ({ name: c.name, nameTr: c.nameTr, aliases: [], notes: [], firstChapter: c.firstChapter, lastChapter: c.firstChapter, seenIn: [], pinned: true })),
    summaries: {},
    summariesEn: {},
  }));
  await fillNotebook(bookId, upTo, lang);
}
