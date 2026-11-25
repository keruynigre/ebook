import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSyncExternalStore } from 'react';

import { http } from './http';
import { getBook, putBook } from './library';
import { sourceById } from './sources';
import { saveChapter } from './storage';
import { sleep } from './text';

export interface DownloadState {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  current?: string;
  error?: string;
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

/**
 * Downloads the given chapter indexes one after another and stores them on the device.
 * Already downloaded chapters are skipped, so an interrupted download can simply be restarted.
 */
export async function startDownload(bookId: string, indexes: number[]): Promise<void> {
  if (states.get(bookId)?.running) return;
  const book = getBook(bookId);
  if (!book) return;
  const have = new Set(book.downloaded);
  const todo = indexes.filter((i) => i >= 0 && i < book.chapters.length && !have.has(i));
  cancelled.delete(bookId);
  const state: DownloadState = { running: true, total: todo.length, done: 0, failed: 0 };
  set(bookId, { ...state });
  if (todo.length === 0) {
    set(bookId, { ...state, running: false, finishedAt: Date.now() });
    return;
  }

  const source = sourceById(book.sourceId);
  const tag = `download-${bookId}`;
  await activateKeepAwakeAsync(tag).catch(() => undefined);
  let consecutive = 0;
  let unsaved = 0;

  const persist = async () => {
    const latest = getBook(bookId);
    if (!latest) return;
    const merged = new Set([...latest.downloaded, ...have]);
    await putBook({ ...latest, downloaded: [...merged].sort((a, b) => a - b), updatedAt: Date.now() });
    unsaved = 0;
  };

  try {
    for (let n = 0; n < todo.length; n++) {
      if (cancelled.has(bookId)) {
        state.error = 'İndirme durduruldu.';
        break;
      }
      const index = todo[n];
      const ref = book.chapters[index];
      state.current = ref.title;
      set(bookId, { ...state });

      let ok = false;
      let lastError = '';
      for (let attempt = 0; attempt < RETRIES && !ok; attempt++) {
        if (attempt > 0) await sleep(2000 * attempt * attempt);
        try {
          const content = await source.getChapter(ref.url, http);
          await saveChapter(bookId, index, { title: ref.title || content.title, paragraphs: content.paragraphs });
          ok = true;
        } catch (e) {
          lastError = (e as Error).message;
        }
      }

      if (ok) {
        have.add(index);
        state.done++;
        consecutive = 0;
        if (++unsaved >= 5) await persist();
      } else {
        state.failed++;
        if (++consecutive >= MAX_CONSECUTIVE_FAILURES) {
          state.error = `Arka arkaya ${consecutive} bölüm indirilemedi: ${lastError}`;
          break;
        }
      }
      set(bookId, { ...state });
      if (n < todo.length - 1) await sleep(DELAY_MS + Math.random() * JITTER_MS);
    }
  } finally {
    await persist().catch(() => undefined);
    deactivateKeepAwake(tag);
    set(bookId, { ...state, running: false, current: undefined, finishedAt: Date.now() });
  }
}
