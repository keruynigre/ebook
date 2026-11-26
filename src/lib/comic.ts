/**
 * Comic pages for a chapter: Gemini writes a panel script (scenes + dialogue),
 * Cloudflare FLUX draws each panel. Everything is saved under the book so a
 * chapter is drawn only once. One chapter is drawn at a time.
 */
import { File } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

import { CloudflareError, drawImage } from './cloudflare';
import { COMIC_HINT, COMIC_SCHEMA, COMIC_SYSTEM, comicRequest, mergeCast, panelPrompt, parseComicScript, type ComicCast, type ComicScript } from './comicCore';
import { GeminiError, generateJson } from './gemini';
import { getBook } from './library';
import { ModelPool } from './modelPool';
import { refreshModelList } from './models';
import { loadNotebook } from './notebook';
import { getCfToken, getGeminiKey, getSettings } from './settings';
import { comicCastFile, comicDir, loadChapter } from './storage';

export type { ComicScript } from './comicCore';

export interface ComicJob {
  running: boolean;
  /** Panels drawn so far / panels in the script (0 while the script is being written). */
  done: number;
  total: number;
  message: string;
  error?: string;
}

const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  for (const l of listeners) l();
};
const jobs = new Map<string, ComicJob>();
const jobKey = (bookId: string, index: number) => `${bookId}:${index}`;
const setJob = (bookId: string, index: number, j: ComicJob) => {
  jobs.set(jobKey(bookId, index), j);
  emit();
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function useVersion() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}

export function useComicJob(bookId: string, index: number): ComicJob | undefined {
  useVersion();
  return jobs.get(jobKey(bookId, index));
}

/** Re-renders whenever a panel is drawn (the value is only a change counter). */
export function useComicVersion(): number {
  return useVersion();
}

// ---- files ------------------------------------------------------------------

const scriptFile = (bookId: string, index: number) => new File(comicDir(bookId, index), 'script.json');
export const panelFile = (bookId: string, index: number, panel: number) => new File(comicDir(bookId, index), `p${panel}.jpg`);

export async function loadComicScript(bookId: string, index: number): Promise<ComicScript | null> {
  const f = scriptFile(bookId, index);
  if (!f.exists) return null;
  try {
    return JSON.parse(await f.text()) as ComicScript;
  } catch {
    return null;
  }
}

async function loadCast(bookId: string): Promise<ComicCast> {
  const f = comicCastFile(bookId);
  if (!f.exists) return {};
  try {
    return JSON.parse(await f.text()) as ComicCast;
  } catch {
    return {};
  }
}

/** Delete one panel picture so it is drawn again. */
export function redrawPanel(bookId: string, index: number, panel: number) {
  const f = panelFile(bookId, index, panel);
  if (f.exists) f.delete();
  emit();
  ensureComic(bookId, index);
}

/** Throw away the whole chapter (script and pictures) and start over. */
export function redoChapter(bookId: string, index: number) {
  const dir = comicDir(bookId, index);
  if (dir.exists) dir.delete();
  emit();
  ensureComic(bookId, index);
}

// ---- queue --------------------------------------------------------------------

const queue: { bookId: string; index: number }[] = [];
let working = false;
let stopFlag = false;

/** Draw this chapter if it is not complete yet (queued behind the one being drawn). */
export function ensureComic(bookId: string, index: number) {
  const k = jobKey(bookId, index);
  if (jobs.get(k)?.running || queue.some((q) => jobKey(q.bookId, q.index) === k)) return;
  queue.push({ bookId, index });
  if (!jobs.get(k)) setJob(bookId, index, { running: true, done: 0, total: 0, message: 'Sırada' });
  else setJob(bookId, index, { ...jobs.get(k)!, running: true, error: undefined, message: 'Sırada' });
  if (!working) run().catch(() => undefined);
}

export function stopComics() {
  stopFlag = true;
}

async function run() {
  working = true;
  stopFlag = false;
  try {
    while (queue.length) {
      const next = queue.shift()!;
      await drawChapter(next.bookId, next.index).catch((e) =>
        setJob(next.bookId, next.index, { ...(jobs.get(jobKey(next.bookId, next.index)) ?? { done: 0, total: 0 }), running: false, message: '', error: (e as Error).message }),
      );
      // After a hard stop (no allowance, bad key) the rest would fail the same way.
      const j = jobs.get(jobKey(next.bookId, next.index));
      if (j?.error && /hakkı doldu|kabul edilmedi|anahtar|Durduruldu/i.test(j.error)) {
        for (const q of queue.splice(0)) setJob(q.bookId, q.index, { running: false, done: 0, total: 0, message: '', error: j.error });
      }
    }
  } finally {
    working = false;
  }
}

async function writeScript(bookId: string, index: number, update: (j: Partial<ComicJob>) => void): Promise<ComicScript> {
  const book = getBook(bookId);
  const key = await getGeminiKey();
  const settings = getSettings();
  if (!book || !key || !settings.geminiModel) throw new Error('Önce Ayarlar’dan Gemini anahtarı girin.');
  const chapter = await loadChapter(bookId, index);
  if (!chapter) throw new Error('Bu bölüm henüz indirilmedi.');
  const cast = await loadCast(bookId);
  const nb = await loadNotebook(bookId);
  // What the notebook knows about the characters up to here (English when there is).
  const notes = nb.characters
    .filter((c) => c.firstChapter <= index)
    .sort((a, b) => b.seenIn.length - a.seenIn.length)
    .slice(0, 60)
    .map((c) => {
      const known = c.notes.filter((n) => n.chapter <= index);
      return { name: c.name, note: known.map((n) => n.en || n.text).slice(-3).join(' ') };
    })
    .filter((x) => x.note);
  const prompt = comicRequest(book.title, chapter.title, chapter.paragraphs.join('\n'), cast, notes);
  const pool = new ModelPool(settings.geminiModel, settings.geminiModels ?? []);
  let refreshed = false;
  let unreadable = 0;
  for (;;) {
    if (stopFlag) throw new Error('Durduruldu.');
    let choice = pool.pick();
    if (!choice && !refreshed) {
      refreshed = true;
      pool.addModels(await refreshModelList(key).catch(() => []));
      choice = pool.pick();
    }
    if (!choice) throw new Error('Gemini’nin bugünkü kullanım hakkı doldu.');
    if ('waitMs' in choice) {
      update({ message: `Gemini yoğun, ${Math.ceil(choice.waitMs / 1000)} sn bekleniyor` });
      await sleep(Math.min(choice.waitMs, 15_000));
      continue;
    }
    try {
      update({ message: 'Sahneler seçiliyor (Gemini)…' });
      const data = await generateJson(key, choice.model, COMIC_SYSTEM, prompt, COMIC_SCHEMA, COMIC_HINT);
      const { script, cast: found } = parseComicScript(index, data);
      if (!script.panels.length) throw new GeminiError('Gemini sahne döndürmedi.', 'other');
      await comicCastFile(bookId).write(JSON.stringify(mergeCast(cast, found)));
      await scriptFile(bookId, index).write(JSON.stringify(script));
      return script;
    } catch (e) {
      if (!(e instanceof GeminiError)) throw e;
      if (e.kind === 'busy' || e.kind === 'rate' || e.kind === 'daily') pool.report(choice.model, e.kind, e.retryAfterMs);
      else if (e.kind === 'unsupported') pool.report(choice.model, 'daily');
      else if (e.kind === 'other' && ++unreadable < 3) continue;
      else throw e;
    }
  }
}

async function drawChapter(bookId: string, index: number) {
  const k = jobKey(bookId, index);
  const update = (j: Partial<ComicJob>) => setJob(bookId, index, { ...(jobs.get(k) ?? { running: true, done: 0, total: 0, message: '' }), running: true, ...j });
  const settings = getSettings();
  const token = await getCfToken();
  if (!token || !settings.cfAccountId) throw new Error('Önce Ayarlar’dan Cloudflare anahtarını girin.');
  update({ message: 'Hazırlanıyor…', error: undefined });
  const script = (await loadComicScript(bookId, index)) ?? (await writeScript(bookId, index, update));
  const cast = await loadCast(bookId);
  const total = script.panels.length;
  const isDrawn = (p: number) => panelFile(bookId, index, p).exists;
  let skipped = 0;
  update({ total, done: script.panels.filter((_, p) => isDrawn(p)).length });
  for (let p = 0; p < total; p++) {
    if (isDrawn(p)) continue;
    let tries = 0;
    for (;;) {
      if (stopFlag) throw new Error('Durduruldu.');
      update({ message: `${p + 1}. kare çiziliyor…` });
      try {
        // A fixed seed per panel keeps a redraw close to the first try only if the prompt is the same.
        const image = await drawImage(token, settings.cfAccountId, panelPrompt(script.panels[p], cast), tries ? undefined : 1000 + index * 31 + p);
        await panelFile(bookId, index, p).write(image, { encoding: 'base64' });
        break;
      } catch (e) {
        if (!(e instanceof CloudflareError)) throw e;
        if (e.kind === 'daily' || e.kind === 'auth') throw e;
        if (e.kind === 'rate' || e.kind === 'busy') {
          if (++tries > 6) throw e;
          update({ message: e.message });
          await sleep(10_000 * tries);
          continue;
        }
        // Refused or broken answer: try once more, then leave this panel empty.
        if (++tries >= 2) {
          skipped++;
          break;
        }
      }
    }
    update({ done: script.panels.filter((_, q) => isDrawn(q)).length });
  }
  const done = script.panels.filter((_, q) => isDrawn(q)).length;
  setJob(bookId, index, {
    running: false,
    done,
    total,
    message: skipped ? `${skipped} kare çizilemedi (uzun basıp yeniden çizebilirsin).` : '',
  });
}

/** Whether a chapter is fully drawn. */
export async function comicComplete(bookId: string, index: number): Promise<boolean> {
  const s = await loadComicScript(bookId, index);
  return !!s && s.panels.every((_, p) => panelFile(bookId, index, p).exists);
}
