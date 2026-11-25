import { Directory, File } from 'expo-file-system';

import { buildEpub, detectImageType } from './epub';
import { coverFile, exportsDir, loadChapter, loadTranslation } from './storage';
import { safeFileName } from './text';
import type { Book, ChapterContent } from './types';

export interface ExportResult {
  file: File;
  chapterCount: number;
  missing: number;
}

/** Builds an EPUB from the downloaded chapters between `from` and `to` (0-based, inclusive). */
export async function exportEpub(book: Book, from: number, to: number, turkish = false): Promise<ExportResult> {
  const chapters: ChapterContent[] = [];
  let missing = 0;
  for (let i = from; i <= to; i++) {
    const tr = turkish ? await loadTranslation(book.id, i) : null;
    if (tr) {
      chapters.push(tr);
      continue;
    }
    const c = await loadChapter(book.id, i);
    if (c) chapters.push({ title: book.chapters[i]?.title || c.title, paragraphs: c.paragraphs });
    else missing++;
  }
  if (chapters.length === 0) throw new Error('Bu aralıkta indirilmiş bölüm yok.');

  let cover = null;
  const cf = coverFile(book);
  if (cf) {
    const bytes = await cf.bytes();
    const type = detectImageType(bytes);
    if (type) cover = { bytes, ...type };
  }

  const whole = from === 0 && to === book.chapters.length - 1;
  const rangeLabel = whole ? undefined : `Bölüm ${from + 1}–${to + 1}`;
  const bytes = await buildEpub({
    meta: {
      id: book.id,
      title: book.title,
      author: book.author,
      description: book.description,
      language: turkish ? 'tr' : book.language,
      sourceUrl: book.url,
    },
    chapters,
    cover,
    rangeLabel,
  });

  const name = `${safeFileName(book.title)}${rangeLabel ? ` (${from + 1}-${to + 1})` : ''}${turkish ? ' (TR)' : ''}.epub`;
  const file = new File(exportsDir(), name);
  if (file.exists) file.delete();
  await file.write(bytes);
  return { file, chapterCount: chapters.length, missing };
}

/** Lets the person pick a folder (e.g. Download) and copies the EPUB there. */
export async function saveToFolder(file: File): Promise<string> {
  const dir = await Directory.pickDirectoryAsync();
  const target = dir.createFile(file.name, 'application/epub+zip');
  await target.write(await file.bytes());
  return dir.name || 'seçilen klasör';
}
