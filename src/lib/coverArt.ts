/**
 * Covers for books that came without one: Gemini describes a cover, and the
 * chosen drawer (Cloudflare or the person's computer) paints it.
 */
import { File } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

import { getDrawer } from './comic';
import { COVER_HINT, COVER_SCHEMA, COVER_SIZE, COVER_SYSTEM, base64ImageExt, coverPrompt, coverRequest } from './coverCore';
import { generateJson } from './gemini';
import { getBook, updateBook } from './library';
import { getGeminiKey, getSettings } from './settings';
import { bookDir } from './storage';
import type { Book } from './types';

const listeners = new Set<() => void>();
const state = new Map<string, { running: boolean; error?: string }>();
const set = (id: string, s: { running: boolean; error?: string }) => {
  state.set(id, s);
  for (const l of listeners) l();
};
let version = 0;
listeners.add(() => version++);

export function useCoverJob(id: string): { running: boolean; error?: string } | undefined {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  return state.get(id);
}

/** Books tried automatically in this run of the app (a failure is retried at the next start). */
const tried = new Set<string>();
const queue: string[] = [];
let working = false;

async function sceneFromGemini(book: Book): Promise<string | undefined> {
  const key = await getGeminiKey();
  const model = getSettings().geminiModel;
  if (!key || !model) return undefined;
  try {
    const data = await generateJson(key, model, COVER_SYSTEM, coverRequest(book.title, book.author, book.description), COVER_SCHEMA, COVER_HINT);
    return typeof data?.prompt === 'string' ? data.prompt : undefined;
  } catch {
    return undefined;
  }
}

async function drawCover(id: string) {
  const book = getBook(id);
  if (!book) return;
  set(id, { running: true });
  try {
    const drawer = await getDrawer();
    const scene = await sceneFromGemini(book);
    const image = await drawer.withRefs(coverPrompt(book.title, book.description, scene), [], COVER_SIZE, Date.now() % 100000);
    const dir = bookDir(id);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    // A new name each time, so the picture is not served from the image cache.
    const name = `cover-ai-${Date.now()}.${base64ImageExt(image)}`;
    await new File(dir, name).write(image, { encoding: 'base64' });
    const old = getBook(id)?.coverFile;
    await updateBook(id, (b) => ({ ...b, coverFile: name, coverAi: true }));
    if (old && old !== name) {
      const f = new File(dir, old);
      if (f.exists) f.delete();
    }
    set(id, { running: false });
  } catch (e) {
    set(id, { running: false, error: (e as Error).message });
  }
}

async function run() {
  working = true;
  try {
    while (queue.length) await drawCover(queue.shift()!);
  } finally {
    working = false;
  }
}

/** Draw a cover for this book now (also replaces an earlier AI cover). */
export function drawBookCover(id: string) {
  if (state.get(id)?.running || queue.includes(id)) return;
  queue.push(id);
  set(id, { running: true });
  if (!working) run().catch(() => undefined);
}

/** Books without a cover get one drawn, if pictures can be drawn at all. */
export async function ensureCovers(books: Book[]) {
  const missing = books.filter((b) => !b.coverFile && !tried.has(b.id));
  if (!missing.length) return;
  try {
    await getDrawer();
  } catch {
    return; // Drawing is not set up; leave the plain placeholder.
  }
  for (const b of missing) {
    tried.add(b.id);
    drawBookCover(b.id);
  }
}
