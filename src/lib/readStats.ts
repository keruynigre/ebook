/** Reading statistics per chapter. Pure helpers, no device APIs. */

export interface ChapterStat {
  /** Words in the chapter as it was shown (Turkish or original). */
  words: number;
  /** Furthest point reached in the chapter (0–1). */
  read: number;
}

export type ReadStats = Record<number, ChapterStat>;

/** From this point on a chapter counts as finished (the end is often notes and buttons). */
export const FINISHED_AT = 0.97;

export function countWords(paragraphs: string[]): number {
  let n = 0;
  for (const p of paragraphs) {
    const m = p.match(/[\p{L}\p{M}\p{N}]+(?:['’.,-][\p{L}\p{M}\p{N}]+)*/gu);
    if (m) n += m.length;
  }
  return n;
}

/** Records a reading position, keeping the furthest point ever reached. */
export function recordRead(stats: ReadStats | undefined, index: number, words: number, position: number): ReadStats {
  const prev = stats?.[index];
  const read = Math.min(1, Math.max(0, Math.max(prev?.read ?? 0, position)));
  if (prev && prev.words === words && prev.read === read) return stats!;
  return { ...stats, [index]: { words, read } };
}

export const isFinished = (s: ChapterStat) => s.read >= FINISHED_AT;

export function wordsRead(s: ChapterStat): number {
  return isFinished(s) ? s.words : Math.round(s.words * s.read);
}

export interface StatsSummary {
  wordsRead: number;
  /** Words in the chapters that were opened. */
  wordsOpened: number;
  opened: number;
  finished: number;
}

export function summarize(stats: ReadStats | undefined): StatsSummary {
  const out: StatsSummary = { wordsRead: 0, wordsOpened: 0, opened: 0, finished: 0 };
  for (const s of Object.values(stats ?? {})) {
    out.opened++;
    out.wordsOpened += s.words;
    out.wordsRead += wordsRead(s);
    if (isFinished(s)) out.finished++;
  }
  return out;
}

/** 12345 → "12.345" (Turkish grouping, without relying on Intl on the phone). */
export function formatCount(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Chapters read before statistics existed, estimated: every chapter before the
 * current one counts as finished, later ones as far as their saved position.
 */
export function pastReading(
  positions: Record<number, number> | undefined,
  current: number | undefined,
  stats: ReadStats | undefined,
): { index: number; read: number }[] {
  const out: { index: number; read: number }[] = [];
  const seen = new Set<number>();
  for (const [k, v] of Object.entries(positions ?? {})) {
    const index = Number(k);
    if (!Number.isInteger(index) || stats?.[index]) continue;
    seen.add(index);
    const read = current !== undefined && index < current ? 1 : Math.max(0, Math.min(1, v));
    out.push({ index, read });
  }
  // Chapters read before positions were kept per chapter: all before the current one.
  if (current !== undefined)
    for (let index = 0; index < current; index++)
      if (!seen.has(index) && !stats?.[index]) out.push({ index, read: 1 });
  return out.sort((a, b) => a.index - b.index);
}
