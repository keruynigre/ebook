import { useSyncExternalStore } from 'react';

import { detectImageType } from './epub';
import { http } from './http';
import { sourceById } from './sources';
import type { ProgressInfo } from './sources/types';
import * as storage from './storage';
import { hashString, slugify } from './text';
import type { Book, NovelInfo } from './types';

/** In-memory copy of the library that screens subscribe to. */
let books: Book[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export async function refreshLibrary(): Promise<void> {
  books = await storage.listBooks();
  loaded = true;
  emit();
}

export function useLibrary(): { books: Book[]; loaded: boolean } {
  const snapshot = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => books,
  );
  return { books: snapshot, loaded };
}

export function useBook(id: string): Book | undefined {
  const all = useLibrary().books;
  return all.find((b) => b.id === id);
}

export function getBook(id: string): Book | undefined {
  return books.find((b) => b.id === id);
}

/** Saves a book and updates every screen that shows it. */
export async function putBook(book: Book): Promise<void> {
  // Update memory first so quick successive changes build on each other.
  const i = books.findIndex((b) => b.id === book.id);
  books = i >= 0 ? books.map((b) => (b.id === book.id ? book : b)) : [book, ...books];
  emit();
  await storage.saveBook(book);
}

/** Applies a change to the latest saved copy of a book. */
export async function updateBook(id: string, change: (b: Book) => Book): Promise<void> {
  const latest = getBook(id);
  if (latest) await putBook(change(latest));
}

export async function saveProgress(id: string, index: number, position: number): Promise<void> {
  await updateBook(id, (b) => ({ ...b, progress: { index, position, updatedAt: Date.now() } }));
}

export async function removeBook(id: string): Promise<void> {
  storage.deleteBook(id);
  books = books.filter((b) => b.id !== id);
  emit();
}

const normalizeUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');

/** The same address always maps to the same book, even if the site renames the novel. */
export function bookIdFor(info: Pick<NovelInfo, 'title' | 'url'>): string {
  const key = normalizeUrl(info.url);
  return books.find((b) => normalizeUrl(b.url) === key)?.id ?? `${slugify(info.title)}-${hashString(key)}`;
}

/** Adds a novel to the library, or updates its chapter list if it is already there. */
export async function addOrUpdateBook(info: NovelInfo): Promise<Book> {
  const id = bookIdFor(info);
  const existing = (await storage.loadBook(id)) ?? undefined;
  const now = Date.now();
  const book: Book = {
    id,
    sourceId: info.sourceId,
    url: info.url,
    title: info.title,
    author: info.author ?? existing?.author ?? '',
    description: info.description ?? existing?.description ?? '',
    language: info.language ?? existing?.language ?? 'en',
    chapters: info.chapters,
    downloaded: remapDownloaded(existing, info),
    coverFile: existing?.coverFile,
    addedAt: existing?.addedAt ?? now,
    updatedAt: now,
  };
  if (!book.coverFile && info.coverUrl) {
    try {
      const bytes = await http.getBytes(info.coverUrl);
      const type = detectImageType(bytes);
      if (type) book.coverFile = await storage.saveCover(id, bytes, type.ext);
    } catch {
      // A missing cover is not worth failing over.
    }
  }
  await putBook(book);
  return book;
}

/**
 * Chapter files are stored by index. If the site's list changed (e.g. a chapter
 * was inserted), keep only indexes whose address is unchanged.
 */
function remapDownloaded(existing: Book | undefined, info: NovelInfo): number[] {
  if (!existing) return [];
  return existing.downloaded.filter((i) => existing.chapters[i]?.url === info.chapters[i]?.url);
}

export async function refreshChapterList(book: Book, onProgress?: (p: ProgressInfo) => void): Promise<Book> {
  const info = await sourceById(book.sourceId).getNovel(book.url, http, onProgress);
  return addOrUpdateBook(info);
}
