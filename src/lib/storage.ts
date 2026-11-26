import { Directory, File, Paths } from 'expo-file-system';

import type { GlossaryEntry } from './gemini';
import type { Book, ChapterContent } from './types';

/**
 * Layout on the device:
 *   <documents>/books/<bookId>/book.json
 *   <documents>/books/<bookId>/cover.<ext>
 *   <documents>/books/<bookId>/chapters/<index>.json
 */

function booksRoot(): Directory {
  const dir = new Directory(Paths.document, 'books');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function bookDir(id: string): Directory {
  return new Directory(booksRoot(), id);
}

function chaptersDir(id: string): Directory {
  const dir = new Directory(bookDir(id), 'chapters');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export async function listBooks(): Promise<Book[]> {
  const books: Book[] = [];
  for (const entry of booksRoot().list()) {
    if (!(entry instanceof Directory)) continue;
    const f = new File(entry, 'book.json');
    if (!f.exists) continue;
    try {
      books.push(JSON.parse(await f.text()) as Book);
    } catch {
      // A damaged entry should not hide the rest of the library.
    }
  }
  return books.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadBook(id: string): Promise<Book | null> {
  const f = new File(bookDir(id), 'book.json');
  if (!f.exists) return null;
  return JSON.parse(await f.text()) as Book;
}

export async function saveBook(book: Book): Promise<void> {
  const dir = bookDir(book.id);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  await new File(dir, 'book.json').write(JSON.stringify(book));
}

export function deleteBook(id: string): void {
  const dir = bookDir(id);
  if (dir.exists) dir.delete();
}

export async function saveChapter(id: string, index: number, content: ChapterContent): Promise<void> {
  await new File(chaptersDir(id), `${index}.json`).write(JSON.stringify(content));
}

export async function loadChapter(id: string, index: number): Promise<ChapterContent | null> {
  const f = new File(chaptersDir(id), `${index}.json`);
  if (!f.exists) return null;
  return JSON.parse(await f.text()) as ChapterContent;
}

export async function saveTranslation(id: string, index: number, content: ChapterContent): Promise<void> {
  await new File(chaptersDir(id), `${index}.tr.json`).write(JSON.stringify(content));
}

export async function loadTranslation(id: string, index: number): Promise<ChapterContent | null> {
  const f = new File(chaptersDir(id), `${index}.tr.json`);
  if (!f.exists) return null;
  return JSON.parse(await f.text()) as ChapterContent;
}

export async function loadGlossary(id: string): Promise<GlossaryEntry[]> {
  const f = new File(bookDir(id), 'glossary.json');
  if (!f.exists) return [];
  try {
    return JSON.parse(await f.text()) as GlossaryEntry[];
  } catch {
    return [];
  }
}

export async function saveGlossary(id: string, glossary: GlossaryEntry[]): Promise<void> {
  await new File(bookDir(id), 'glossary.json').write(JSON.stringify(glossary));
}

export async function saveCover(id: string, bytes: Uint8Array, ext: string): Promise<string> {
  const name = `cover.${ext}`;
  const dir = bookDir(id);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  await new File(dir, name).write(bytes);
  return name;
}

export function coverFile(book: Book): File | null {
  if (!book.coverFile) return null;
  const f = new File(bookDir(book.id), book.coverFile);
  return f.exists ? f : null;
}

export function exportsDir(): Directory {
  const dir = new Directory(Paths.cache, 'exports');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Bytes the book takes on the phone (chapters, translations, cover, glossary). */
const sizeCache = new Map<string, { key: string; bytes: number }>();
/** `version` changes whenever the book's files change (e.g. updatedAt), so the folder is only measured then. */
export function bookSize(id: string, version = ''): number {
  const hit = sizeCache.get(id);
  if (hit && hit.key === version) return hit.bytes;
  let bytes = 0;
  try {
    const dir = bookDir(id);
    bytes = dir.exists ? (dir.size ?? 0) : 0;
  } catch {
    bytes = 0;
  }
  sizeCache.set(id, { key: version, bytes });
  return bytes;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export async function loadNotebookFile(id: string): Promise<unknown> {
  const f = new File(bookDir(id), 'notebook.json');
  if (!f.exists) return null;
  try {
    return JSON.parse(await f.text());
  } catch {
    return null;
  }
}

export async function saveNotebookFile(id: string, data: unknown): Promise<void> {
  const dir = bookDir(id);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  await new File(dir, 'notebook.json').write(JSON.stringify(data));
}

/** <book>/comic/<index>/ holds script.json and the panel pictures (p0.jpg, p1.jpg …). */
export function comicDir(id: string, index: number): Directory {
  const dir = new Directory(bookDir(id), 'comic', String(index));
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function comicCastFile(id: string): File {
  const dir = new Directory(bookDir(id), 'comic');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return new File(dir, 'cast.json');
}

/** Character reference cards of a book, one folder per drawing mode (bw / color). */
export function comicCardsDir(id: string, mode: string): Directory {
  const dir = new Directory(bookDir(id), 'comic', 'cards', mode);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}
