/**
 * Word notebook: words looked up in the reader that the person saved, to go
 * over again later. One list for all books, kept in words.json.
 */
import { File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

export interface SavedWord {
  word: string;
  lang: 'tr' | 'en';
  meaning: string;
  sentence: string;
  bookId?: string;
  bookTitle?: string;
  chapter?: number;
  addedAt: number;
  /** Marked as learned in review. */
  known?: boolean;
  /** Times reviewed / times known. */
  seen?: number;
  right?: number;
}

const file = () => new File(Paths.document, 'words.json');
let words: SavedWord[] = [];
let loaded = false;
const listeners = new Set<() => void>();

export const wordKey = (w: { word: string; lang: string }) => `${w.lang}:${w.word.toLocaleLowerCase(w.lang === 'tr' ? 'tr' : 'en')}`;

function emit() {
  for (const l of listeners) l();
}

async function persist() {
  const f = file();
  if (!f.exists) f.create();
  await f.write(JSON.stringify(words));
}

export async function loadWords(): Promise<SavedWord[]> {
  if (loaded) return words;
  loaded = true;
  try {
    const f = file();
    if (f.exists) words = JSON.parse(await f.text()) as SavedWord[];
  } catch {
    words = [];
  }
  emit();
  return words;
}

/** Read words.json again (after a backup is restored). */
export async function reloadWords() {
  loaded = false;
  await loadWords();
}

export function useWords(): SavedWord[] {
  if (!loaded) loadWords().catch(() => undefined);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => words,
  );
}

export function isSaved(w: { word: string; lang: string }): boolean {
  const k = wordKey(w);
  return words.some((x) => wordKey(x) === k);
}

/** Save a word (a word already in the list is updated and moved to the top). */
export async function saveWord(w: Omit<SavedWord, 'addedAt'>) {
  await loadWords();
  const k = wordKey(w);
  const old = words.find((x) => wordKey(x) === k);
  words = [{ ...old, ...w, addedAt: Date.now() }, ...words.filter((x) => wordKey(x) !== k)];
  emit();
  await persist();
}

export async function removeWord(w: { word: string; lang: string }) {
  await loadWords();
  const k = wordKey(w);
  words = words.filter((x) => wordKey(x) !== k);
  emit();
  await persist();
}

/** Record one review answer. */
export async function reviewWord(w: { word: string; lang: string }, knewIt: boolean) {
  await loadWords();
  const k = wordKey(w);
  words = words.map((x) =>
    wordKey(x) === k ? { ...x, seen: (x.seen ?? 0) + 1, right: (x.right ?? 0) + (knewIt ? 1 : 0), known: knewIt ? (x.right ?? 0) + 1 >= 2 || x.known : false } : x,
  );
  emit();
  await persist();
}

export async function setKnown(w: { word: string; lang: string }, known: boolean) {
  await loadWords();
  const k = wordKey(w);
  words = words.map((x) => (wordKey(x) === k ? { ...x, known } : x));
  emit();
  await persist();
}
