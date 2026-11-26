/**
 * Pictures inside the text of a chapter: Gemini picks the key moments (mostly the
 * important characters' dialogue) and the paragraph each belongs under,
 * Cloudflare FLUX draws them. Everything is saved under the book so a
 * chapter is drawn only once. One chapter is drawn at a time.
 */
import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useSyncExternalStore } from 'react';

import { CloudflareError, drawImage, drawWithRefs } from './cloudflare';
import {
  COMIC_HINT,
  COMIC_SCHEMA,
  COMIC_QUALITY,
  panelRange,
  comicSystem,
  cardPrompt,
  castNames,
  comicRequest,
  mergeCast,
  panelPrompt,
  parseComicScript,
  type ComicCast,
  type ComicScript,
} from './comicCore';
import { GeminiError, generateJson } from './gemini';
import { getBook } from './library';
import { ModelPool } from './modelPool';
import { refreshModelList } from './models';
import { loadNotebook } from './notebook';
import { getCfToken, getGeminiKey, getSettings, setSettings } from './settings';
import { comicCardsDir, comicCastFile, comicDir, loadChapter } from './storage';

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

// ---- art style picture and character cards -----------------------------------

/** Reference pictures must be under 512×512 for FLUX.2. */
const REF_SIDE = 480;

export const styleRefFile = () => new File(Paths.document, 'comic-style.jpg');

/** Let the user pick a picture whose drawing style the panels should follow. */
export async function chooseStyleImage(): Promise<boolean> {
  const picked = await File.pickFileAsync({ mimeTypes: ['image/*'] });
  if (picked.canceled || !picked.result) return false;
  const first = await ImageManipulator.manipulate(picked.result.uri).renderAsync();
  const scale = REF_SIDE / Math.max(first.width, first.height, 1);
  const size = scale < 1 ? { width: Math.round(first.width * scale), height: Math.round(first.height * scale) } : { width: first.width, height: first.height };
  const ref = await ImageManipulator.manipulate(picked.result.uri).resize(size).renderAsync();
  const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  const target = styleRefFile();
  if (target.exists) target.delete();
  new File(saved.uri).copy(target);
  setSettings({ comicStyleRef: true, comicStyleVersion: (getSettings().comicStyleVersion ?? 0) + 1 });
  return true;
}

export function clearStyleImage() {
  const f = styleRefFile();
  if (f.exists) f.delete();
  setSettings({ comicStyleRef: false });
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
const cardFile = (bookId: string, name: string, color: boolean, styled: boolean) =>
  new File(comicCardsDir(bookId, `${color ? 'color' : 'bw'}${styled ? `-s${getSettings().comicStyleVersion ?? 0}` : ''}`), `${slug(name)}.jpg`);

/** The character's reference card, drawn once per book and drawing mode. Null if it could not be drawn. */
async function ensureCard(
  token: string,
  accountId: string,
  bookId: string,
  name: string,
  look: string,
  color: boolean,
  style: File | null,
): Promise<File | null> {
  const f = cardFile(bookId, name, color, !!style);
  if (f.exists) return f;
  try {
    const image = await drawWithRefs(token, accountId, cardPrompt(name, look, color, !!style), style ? [style.uri] : [], { width: REF_SIDE, height: REF_SIDE }, 7);
    await f.write(image, { encoding: 'base64' });
    return f;
  } catch (e) {
    if (e instanceof CloudflareError && (e.kind === 'daily' || e.kind === 'auth')) throw e;
    return null;
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
  // The characters seen in the most chapters so far: the main character and the important ones.
  const important = nb.characters
    .filter((c) => c.firstChapter <= index)
    .map((c) => ({ name: c.name, n: c.seenIn.filter((k) => k <= index).length }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8)
    .map((c) => c.name);
  const prompt = comicRequest(book.title, chapter.title, chapter.paragraphs, cast, notes, important);
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
      const range = panelRange(settings.comicQuality ?? 'balanced', settings.comicCount ?? 0);
      const data = await generateJson(key, choice.model, comicSystem(range), prompt, COMIC_SCHEMA, COMIC_HINT);
      const { script, cast: found } = parseComicScript(index, data, chapter.paragraphs.length);
      script.panels = script.panels.slice(0, range[1]);
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
  const color = !!settings.comicColor;
  const styleFile = settings.comicStyleRef && styleRefFile().exists ? styleRefFile() : null;
  const quality = COMIC_QUALITY[settings.comicQuality ?? 'balanced'];
  const total = script.panels.length;
  const isDrawn = (p: number) => panelFile(bookId, index, p).exists;
  let skipped = 0;
  update({ total, done: script.panels.filter((_, p) => isDrawn(p)).length });
  for (let p = 0; p < total; p++) {
    if (isDrawn(p)) continue;
    let tries = 0;
    let waits = 0;
    for (;;) {
      if (stopFlag) throw new Error('Durduruldu.');
      update({ message: `${p + 1}. kare çiziliyor…` });
      try {
        const panel = script.panels[p];
        const seed = tries ? undefined : 1000 + index * 31 + p;
        let image: string;
        if (tries < 2) {
          // FLUX.2 with the style picture and the characters' reference cards.
          const names = castNames(panel, cast).slice(0, Math.max(1, quality.refs - (styleFile ? 1 : 0)));
          const cards: { name: string; file: File }[] = [];
          for (const n of names) {
            update({ message: `${n} için karakter kartı hazırlanıyor…` });
            const card = await ensureCard(token, settings.cfAccountId, bookId, n, cast[n], color, styleFile);
            if (card) cards.push({ name: n, file: card });
          }
          update({ message: `${p + 1}. kare çiziliyor…` });
          const refs = [...(styleFile ? [styleFile.uri] : []), ...cards.map((c) => c.file.uri)];
          image = await drawWithRefs(
            token,
            settings.cfAccountId,
            panelPrompt(panel, cast, color, { style: !!styleFile, cards: cards.map((c) => c.name) }),
            refs,
            { width: quality.width, height: quality.height },
            seed,
          );
        } else {
          // Last resort: the older text-only model.
          image = await drawImage(token, settings.cfAccountId, panelPrompt(panel, cast, color), seed);
        }
        await panelFile(bookId, index, p).write(image, { encoding: 'base64' });
        break;
      } catch (e) {
        if (!(e instanceof CloudflareError)) throw e;
        if (e.kind === 'daily' || e.kind === 'auth') throw e;
        if (e.kind === 'rate' || e.kind === 'busy') {
          if (++waits > 6) throw e;
          update({ message: e.message });
          await sleep(10_000 * waits);
          continue;
        }
        // Refused or broken answer: try again, then with the older model, then leave this panel empty.
        if (++tries >= 3) {
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
