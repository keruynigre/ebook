import { getBook, updateBook } from './library';
import { countWords, pastReading } from './readStats';
import { loadChapter, loadTranslation } from './storage';

/**
 * Counts the words of chapters read before statistics existed (estimated from the
 * saved reading positions). Runs once per book; can be stopped and resumed.
 */
export async function backfillReadStats(
  id: string,
  preferTranslation: boolean,
  onProgress: (done: number, total: number) => void,
  stopped: () => boolean,
): Promise<void> {
  const book = getBook(id);
  if (!book || book.readStatsBackfilled) return;
  const downloaded = new Set(book.downloaded);
  const translated = new Set(book.translated ?? []);
  const todo = pastReading(book.positions, book.progress?.index, book.readStats).filter((x) => downloaded.has(x.index));
  let batch: Record<number, { words: number; read: number }> = {};
  const flush = async () => {
    const add = batch;
    batch = {};
    if (!Object.keys(add).length) return;
    // Entries recorded by the reader in the meantime win.
    await updateBook(id, (b) => ({ ...b, readStats: { ...add, ...b.readStats } }));
  };
  for (let k = 0; k < todo.length; k++) {
    if (stopped()) return flush();
    const { index, read } = todo[k];
    try {
      const c = (preferTranslation && translated.has(index) ? await loadTranslation(id, index) : null) ?? (await loadChapter(id, index));
      const words = c ? countWords([c.title ?? '', ...c.paragraphs]) : 0;
      if (words) batch[index] = { words, read };
    } catch {
      // An unreadable file is simply left out.
    }
    if (k % 25 === 24) {
      await flush();
      onProgress(k + 1, todo.length);
    }
  }
  await flush();
  await updateBook(id, (b) => ({ ...b, readStatsBackfilled: true }));
  onProgress(todo.length, todo.length);
}
