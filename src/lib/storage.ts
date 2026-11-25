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
