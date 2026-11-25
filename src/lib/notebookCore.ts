/** Story notebook data and merge rules (no React Native imports, so it can be tested). */

export interface CharacterNote {
  chapter: number;
  text: string;
}

export interface NotebookCharacter {
  name: string;
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
}

export interface ChapterInfo {
  summary?: string;
  characters: { name: string; description: string }[];
}

export const emptyNotebook = (): Notebook => ({ characters: [], summaries: {} });

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
  const exact = list.findIndex((c) => normName(c.name) === n || c.aliases.some((a) => normName(a) === n));
  if (exact >= 0) return exact;
  const words = n.split(' ');
  const partial: number[] = [];
  list.forEach((c, k) => {
    const cw = normName(c.name).split(' ');
    const shorter = words.length <= cw.length ? words : cw;
    const longer = words.length <= cw.length ? cw : words;
    if (shorter.length < longer.length && shorter.every((w) => w.length > 1 && longer.includes(w))) partial.push(k);
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
    let k = findCharacter(characters, name);
    if (k < 0) {
      characters.push({ name, aliases: [], notes: [], firstChapter: chapter, lastChapter: chapter, seenIn: [] });
      k = characters.length - 1;
    }
    const c = characters[k];
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
    if (description) {
      c.notes = c.notes.filter((x) => x.chapter !== chapter || normText(x.text) === normText(description));
      if (!c.notes.some((x) => normText(x.text) === normText(description))) c.notes.push({ chapter, text: description });
      c.notes.sort((a, b) => a.chapter - b.chapter);
      if (c.notes.length > MAX_NOTES) c.notes = [c.notes[0], ...c.notes.slice(-(MAX_NOTES - 1))];
    }
  }
  const summaries = { ...nb.summaries };
  if (info.summary?.trim()) summaries[String(chapter)] = info.summary.trim();
  return { characters, summaries };
}

/** Parse the optional notebook fields of a Gemini answer. */
export function parseChapterInfo(data: any): ChapterInfo {
  const characters = Array.isArray(data?.characters)
    ? data.characters
        .filter((c: any) => typeof c?.name === 'string' && c.name.trim())
        .map((c: any) => ({ name: c.name.trim(), description: typeof c.description === 'string' ? c.description.trim() : '' }))
    : [];
  const summary = typeof data?.summary === 'string' ? data.summary.trim() : undefined;
  return { summary: summary || undefined, characters };
}
