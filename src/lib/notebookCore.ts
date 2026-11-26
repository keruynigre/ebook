/** Story notebook data and merge rules (no React Native imports, so it can be tested). */

export interface CharacterNote {
  chapter: number;
  /** Turkish. */
  text: string;
  /** English. */
  en?: string;
}

export interface NotebookCharacter {
  /** Original (pinyin) name, or a short English label for unnamed characters ("Tie Zhu's Father"). */
  name: string;
  /** The same name as written in the Turkish text, when it differs ("Tie Zhu'nun Babası"). */
  nameTr?: string;
  aliases: string[];
  /** What the story has revealed about them (looks, identity, abilities, relations), oldest first. */
  notes: CharacterNote[];
  firstChapter: number;
  lastChapter: number;
  /** Chapters they appear in. */
  seenIn: number[];
}

export interface Notebook {
  characters: NotebookCharacter[];
  /** Chapter index → short Turkish summary. */
  summaries: Record<string, string>;
  /** Chapter index → the same summary in English. */
  summariesEn?: Record<string, string>;
  /**
   * Chapters checked and found to have no characters worth noting. A chapter with a
   * summary but no characters and not listed here was saved by a version whose
   * answers often left the characters out, so it is processed again.
   */
  noCast?: number[];
}

export interface ChapterInfo {
  summary?: string;
  summaryEn?: string;
  characters: { name: string; nameTr?: string; description: string; descriptionEn?: string }[];
}

export const emptyNotebook = (): Notebook => ({ characters: [], summaries: {}, summariesEn: {} });

/** Rough check: text with no Turkish-only letters is taken as English (old notes stored one language only). */
export const looksTurkish = (s: string) => /[çğıöşüÇĞİÖŞÜ]/.test(s) || s.trim().length < 25;

/** A character's name in the reader's language. */
export const displayName = (c: Pick<NotebookCharacter, 'name' | 'nameTr'>, lang: 'tr' | 'en') => (lang === 'tr' && c.nameTr) || c.name;

/** Names written with Turkish suffixes or letters ("Tie Zhu'nun Babası"): saved by older versions in the wrong field. */
export const isTurkishName = (s: string) => /[çğıöşÇĞİÖŞ]|['’](n?[ıiuü]n|[ıiuü]|[dt][ae]n?)(\s|$)/.test(s);

/**
 * Drops characters stored under a Turkish name and forgets the chapters they were
 * seen in, so "Güncelle" processes those chapters again with proper names.
 */
export function dropTurkishNames(nb: Notebook): Notebook {
  const bad = nb.characters.filter((c) => isTurkishName(c.name));
  if (!bad.length) return nb;
  const redo = new Set(bad.flatMap((c) => c.seenIn));
  const keep = (rec: Record<string, string> | undefined) => Object.fromEntries(Object.entries(rec ?? {}).filter(([k]) => !redo.has(Number(k))));
  return {
    ...nb,
    characters: nb.characters
      .filter((c) => !isTurkishName(c.name))
      .map((c) => ({ ...c, notes: c.notes.filter((n) => !redo.has(n.chapter)) })),
    summaries: keep(nb.summaries),
    summariesEn: keep(nb.summariesEn),
    noCast: (nb.noCast ?? []).filter((k) => !redo.has(k)),
  };
}

/** Text of a note in the reader's language, falling back to the other one. */
export function noteText(n: CharacterNote, lang: 'tr' | 'en'): string {
  if (lang === 'en') return n.en || n.text;
  if (n.text && (looksTurkish(n.text) || !n.en)) return n.text;
  return n.en || n.text || '';
}

/** Whether a chapter still has to be (re)processed so the notebook can show it in `lang`. */
export function chapterNeedsWork(nb: Notebook, chapter: number, lang: 'tr' | 'en', withCast?: Set<number>): boolean {
  const k = String(chapter);
  const tr = nb.summaries[k];
  if (!tr) return true;
  if (tr === '—') return false;
  if (lang === 'en' ? !nb.summariesEn?.[k] : !looksTurkish(tr)) return true;
  const cast = withCast ?? chaptersWithCast(nb);
  if (!cast.has(chapter) && !nb.noCast?.includes(chapter)) return true;
  // Character notes saved by older versions in one language only.
  return nb.characters.some((c) =>
    c.notes.some((n) => n.chapter === chapter && (lang === 'en' ? !n.en : !n.text || (!looksTurkish(n.text) && !n.en))),
  );
}

/** Chapters at least one character was seen in. */
export function chaptersWithCast(nb: Notebook): Set<number> {
  const out = new Set<number>();
  for (const c of nb.characters) for (const k of c.seenIn) out.add(k);
  return out;
}

/** Drop a chapter's character notes before it is processed again, so no one-language leftovers remain. */
export function clearChapterNotes(nb: Notebook, chapter: number): Notebook {
  return { ...nb, characters: nb.characters.map((c) => ({ ...c, notes: c.notes.filter((n) => n.chapter !== chapter) })) };
}

const MAX_NOTES = 24;

export const normName = (s: string) =>
  s
    .toLocaleLowerCase('tr')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normText = (s: string) => normName(s);

/** Index of the character this name refers to: exact name/alias, else a unique partial-name match. */
export function findCharacter(list: NotebookCharacter[], name: string): number {
  const n = normName(name);
  if (!n) return -1;
  const exact = list.findIndex(
    (c) => normName(c.name) === n || (!!c.nameTr && normName(c.nameTr) === n) || c.aliases.some((a) => normName(a) === n),
  );
  if (exact >= 0) return exact;
  const words = n.split(' ');
  const partial: number[] = [];
  list.forEach((c, k) => {
    const cw = normName(c.name).split(' ');
    const shorter = words.length <= cw.length ? words : cw;
    const longer = words.length <= cw.length ? cw : words;
    // "Zhuo" ~ "Wang Zhuo", but not "Tie Zhu" ~ "Tie Zhu's Father".
    if (shorter.length < longer.length && longer.length - shorter.length === 1 && shorter.every((w) => w.length > 1 && longer.includes(w))) partial.push(k);
  });
  return partial.length === 1 ? partial[0] : -1;
}

/** Add what one chapter revealed. Re-processing a chapter replaces its earlier notes and summary. */
export function mergeChapterInfo(nb: Notebook, chapter: number, info: ChapterInfo): Notebook {
  const characters = nb.characters.map((c) => ({ ...c, notes: [...c.notes], aliases: [...c.aliases], seenIn: [...c.seenIn] }));
  for (const raw of info.characters) {
    const name = raw.name?.trim();
    if (!name || name.length > 60) continue;
    const description = (raw.description ?? '').trim();
    const descriptionEn = (raw.descriptionEn ?? '').trim();
    let k = findCharacter(characters, name);
    if (k < 0) {
      characters.push({ name, aliases: [], notes: [], firstChapter: chapter, lastChapter: chapter, seenIn: [] });
      k = characters.length - 1;
    }
    const c = characters[k];
    const nameTr = raw.nameTr?.trim();
    if (nameTr && normName(nameTr) !== normName(name) && nameTr.length <= 60) c.nameTr = nameTr;
    // Prefer the fuller name as the display name and remember the other as an alias.
    if (normName(name) !== normName(c.name)) {
      if (name.split(/\s+/).length > c.name.split(/\s+/).length) {
        if (!c.aliases.some((a) => normName(a) === normName(c.name))) c.aliases.push(c.name);
        c.name = name;
      } else if (!c.aliases.some((a) => normName(a) === normName(name))) c.aliases.push(name);
    }
    c.firstChapter = Math.min(c.firstChapter, chapter);
    c.lastChapter = Math.max(c.lastChapter, chapter);
    if (!c.seenIn.includes(chapter)) c.seenIn = [...c.seenIn, chapter].sort((a, b) => a - b);
    if (description || descriptionEn) {
      const key = normText(description || descriptionEn);
      const same = (x: CharacterNote) => normText(x.text || x.en || '') === key;
      c.notes = c.notes.filter((x) => x.chapter !== chapter || same(x));
      const existing = c.notes.find(same);
      if (existing) {
        if (descriptionEn && !existing.en) existing.en = descriptionEn;
      } else c.notes.push(descriptionEn ? { chapter, text: description, en: descriptionEn } : { chapter, text: description });
      c.notes.sort((a, b) => a.chapter - b.chapter);
      if (c.notes.length > MAX_NOTES) c.notes = [c.notes[0], ...c.notes.slice(-(MAX_NOTES - 1))];
    }
  }
  const summaries = { ...nb.summaries };
  const summariesEn = { ...(nb.summariesEn ?? {}) };
  if (info.summary?.trim()) summaries[String(chapter)] = info.summary.trim();
  if (info.summaryEn?.trim()) summariesEn[String(chapter)] = info.summaryEn.trim();
  const noCast = (nb.noCast ?? []).filter((k) => k !== chapter);
  if (!info.characters.length) noCast.push(chapter);
  return { ...nb, characters, summaries, summariesEn, noCast };
}

/** Parse the optional notebook fields of a Gemini answer. */
export function parseChapterInfo(data: any): ChapterInfo {
  const characters = Array.isArray(data?.characters)
    ? data.characters
        .filter((c: any) => typeof c?.name === 'string' && c.name.trim())
        .map((c: any) => {
          const out: ChapterInfo['characters'][number] = {
            name: c.name.trim(),
            ...(typeof c.name_tr === 'string' && c.name_tr.trim() ? { nameTr: c.name_tr.trim() } : null),
            description: typeof c.description === 'string' ? c.description.trim() : '',
          };
          if (typeof c.description_en === 'string' && c.description_en.trim()) out.descriptionEn = c.description_en.trim();
          return out;
        })
    : [];
  const summary = typeof data?.summary === 'string' ? data.summary.trim() : undefined;
  const summaryEn = typeof data?.summary_en === 'string' ? data.summary_en.trim() : undefined;
  const info: ChapterInfo = { summary: summary || undefined, characters };
  if (summaryEn) info.summaryEn = summaryEn;
  return info;
}

/** At most this many chapters are filled in on their own when the reader moves on. */
export const AUTO_MAX = 3;

/**
 * Chapters to fill in on their own after moving to a new chapter: only when the notebook
 * follows the story from its first chapter and just a few recent ones are missing.
 * A notebook started mid-story (or far behind) is left to the "Güncelle" button.
 */
export function autoChapters(nb: Notebook, missing: number[], upTo: number): number[] {
  if (!missing.length || missing.length > AUTO_MAX) return [];
  const fromStart = !!nb.summaries['0'] || upTo < AUTO_MAX;
  return fromStart ? missing : [];
}
