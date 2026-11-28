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
  /** Short card written by Gemini from the notes up to `upTo`: the most telling traits and nicknames per language. */
  profile?: CharacterProfile;
  /** The reader chose the main name; it is never replaced on its own. */
  pinned?: boolean;
}

export interface CharacterProfile {
  /** Last chapter the notes behind this card came from (never shown before the reader gets there). */
  upTo: number;
  /** How many notes (up to `upTo`) the card was written from. */
  noteCount: number;
  traitsTr: string[];
  traitsEn: string[];
  aliasesTr: string[];
  aliasesEn: string[];
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
  characters: { name: string; nameTr?: string; aliases?: string[]; description: string; descriptionEn?: string }[];
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

/** Known characters for a prompt: "Wang Lin (Tie Zhu, Wang Lin's Father's son)". */
export function knownCharacterList(nb: Notebook, max = 150): string[] {
  return [...nb.characters]
    .sort((a, b) => b.lastChapter - a.lastChapter)
    .slice(0, max)
    .map((c) => (c.aliases.length ? `${c.name} (${c.aliases.slice(0, 4).join(', ')})` : c.name));
}

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

/** Exact name, Turkish name or alias match. */
function findExact(list: NotebookCharacter[], name: string): number {
  const n = normName(name);
  if (!n) return -1;
  return list.findIndex(
    (c) => normName(c.name) === n || (!!c.nameTr && normName(c.nameTr) === n) || c.aliases.some((a) => normName(a) === n),
  );
}

function addAlias(c: NotebookCharacter, a: string) {
  const n = normName(a);
  if (!n || n === normName(c.name) || (c.nameTr && n === normName(c.nameTr))) return;
  if (!c.aliases.some((x) => normName(x) === n)) c.aliases.push(a);
  if (c.aliases.length > 12) c.aliases = c.aliases.slice(-12);
}

/** English labels for unnamed people ("Tie Zhu's Father", "Fourth Uncle") rather than names. */
export const isLabel = (s: string) =>
  /['’]s\b|\b(the|of|father|mother|uncle|aunt|brother|sister|son|daughter|elder|senior|junior|old|young|master|man|woman|boy|girl|wife|husband|grandfather|grandmother|cousin|disciple|leader|patriarch|first|second|third|fourth|fifth|sixth|seventh)\b/i.test(s);

/** Whether `next` should replace `current` as the main name: a real name beats a label, a fuller name a shorter one. */
export function betterName(next: string, current: string): boolean {
  const nl = isLabel(next);
  const cl = isLabel(current);
  if (nl !== cl) return !nl;
  if (nl) return false;
  // A fuller form of the same name ("Chu Yang" for "Yang"), never a different name such as a disguise.
  const nw = normName(next).split(' ');
  const cw = normName(current).split(' ');
  return nw.length > cw.length && cw.every((w) => nw.includes(w));
}

/** One record for two that turned out to be the same person. The better name stays the main one. */
export function joinCharacters(a: NotebookCharacter, b: NotebookCharacter, keepFirst = false): NotebookCharacter {
  // Otherwise: a chosen name stays, a fuller name wins, else the name seen in more chapters.
  const bFirst =
    !keepFirst && !a.pinned && (b.pinned || betterName(b.name, a.name) || (!betterName(a.name, b.name) && b.seenIn.length > a.seenIn.length));
  const [main, other] = bFirst ? [b, a] : [a, b];
  const c: NotebookCharacter = {
    ...main,
    aliases: [...main.aliases],
    notes: [...main.notes],
    seenIn: [...new Set([...main.seenIn, ...other.seenIn])].sort((x, y) => x - y),
    firstChapter: Math.min(main.firstChapter, other.firstChapter),
    lastChapter: Math.max(main.lastChapter, other.lastChapter),
  };
  for (const x of [other.name, other.nameTr ?? '', ...other.aliases]) addAlias(c, x);
  for (const n of other.notes) {
    const key = normName(n.text || n.en || '');
    if (!c.notes.some((x) => x.chapter === n.chapter && normName(x.text || x.en || '') === key)) c.notes.push(n);
  }
  c.notes.sort((x, y) => x.chapter - y.chapter);
  if (c.notes.length > MAX_NOTES) c.notes = [c.notes[0], ...c.notes.slice(-(MAX_NOTES - 1))];
  return c;
}

/** Joins the characters named in each group (main name first) into one; unknown names are ignored. */
export function mergeCharacterGroups(nb: Notebook, groups: string[][]): Notebook {
  let characters = [...nb.characters];
  for (const g of groups) {
    const idx = [...new Set(g.map((n) => findExact(characters, n)).filter((k) => k >= 0))];
    if (idx.length < 2) continue;
    let joined = characters[idx[0]];
    for (const k of idx.slice(1)) joined = joinCharacters(joined, characters[k], true);
    // The group's main name (the real name) may be only an alias of the record: make it the main name.
    if (!joined.pinned && normName(g[0]) !== normName(joined.name) && joined.aliases.some((a) => normName(a) === normName(g[0])))
      joined = renamed(joined, g[0].trim());
    const drop = new Set(idx.slice(1));
    characters = characters.map((c, k) => (k === idx[0] ? joined : c)).filter((_, k) => !drop.has(k));
  }
  return { ...nb, characters };
}

/** Add what one chapter revealed. Re-processing a chapter replaces its earlier notes and summary. */
export function mergeChapterInfo(nb: Notebook, chapter: number, info: ChapterInfo): Notebook {
  const characters = nb.characters.map((c) => ({ ...c, notes: [...c.notes], aliases: [...c.aliases], seenIn: [...c.seenIn] }));
  for (const raw of info.characters) {
    const name = raw.name?.trim();
    if (!name || name.length > 60) continue;
    const description = (raw.description ?? '').trim();
    const descriptionEn = (raw.descriptionEn ?? '').trim();
    const aliases = (raw.aliases ?? []).map((a) => a.trim()).filter((a) => a && a.length <= 60 && normName(a) !== normName(name));
    let k = findCharacter(characters, name);
    const byName = k >= 0;
    // Other names given for the same person ("Tie Zhu" for Wang Lin) join records kept apart so far.
    for (const a of aliases) {
      const j = findExact(characters, a);
      if (j < 0 || j === k) continue;
      if (k < 0) k = j;
      else {
        const [keep, drop] = [Math.min(k, j), Math.max(k, j)];
        characters[keep] = joinCharacters(characters[keep], characters[drop]);
        characters.splice(drop, 1);
        k = keep;
      }
    }
    if (k < 0) {
      characters.push({ name, aliases: [], notes: [], firstChapter: chapter, lastChapter: chapter, seenIn: [] });
      k = characters.length - 1;
    }
    const c = characters[k];
    const nameTr = raw.nameTr?.trim();
    if (normName(name) !== normName(c.name)) {
      // Found only through an alias: the answer names the main name ("Wang Lin" for "Tie Zhu").
      // A new name for an established character (often a disguise) stays an alias.
      if (!c.pinned && (betterName(name, c.name) || (!byName && !isLabel(name) && (isLabel(c.name) || c.seenIn.length < 5)))) {
        addAlias(c, c.name);
        if (c.nameTr) addAlias(c, c.nameTr);
        c.name = name;
        c.nameTr = undefined;
      } else addAlias(c, name);
    }
    if (nameTr && normName(nameTr) !== normName(c.name) && nameTr.length <= 60) {
      if (normName(name) === normName(c.name)) c.nameTr = nameTr;
      else addAlias(c, nameTr);
    }
    for (const a of aliases) addAlias(c, a);
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
            ...(Array.isArray(c.aliases)
              ? { aliases: c.aliases.filter((a: unknown) => typeof a === 'string' && a.trim()).map((a: string) => a.trim()).slice(0, 6) }
              : null),
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
 * Chapters to fill in on their own after moving to a new chapter: the missing ones among the
 * last few chapters up to the reading point, wherever the notebook started. An empty notebook
 * far into the book is left to the "Güncelle" button.
 */
export function autoChapters(nb: Notebook, missing: number[], upTo: number): number[] {
  const recent = missing.filter((i) => i <= upTo && i > upTo - AUTO_MAX);
  if (!recent.length) return [];
  const started = Object.keys(nb.summaries).length > 0 || nb.characters.length > 0 || upTo < AUTO_MAX;
  return started ? recent : [];
}

// ---- short character cards ------------------------------------------------------

export const MAX_TRAITS = 5;
/** A character gets a short card once it has this many notes; fewer notes are shown as they are. */
export const PROFILE_MIN_NOTES = 3;
/** The card is written again after this many new notes. */
export const PROFILE_REFRESH = 4;

/** The card that may be shown at reading point `upTo` (none if it was written from later chapters). */
export function profileFor(c: NotebookCharacter, upTo: number): CharacterProfile | undefined {
  const p = c.profile;
  return p && p.upTo <= upTo && p.traitsTr.length ? p : undefined;
}

/** Whether the character's card is missing or behind its notes up to `upTo`. */
export function needsProfile(c: NotebookCharacter, upTo: number): boolean {
  const notes = c.notes.filter((n) => n.chapter <= upTo).length;
  if (notes < PROFILE_MIN_NOTES && c.aliases.length < 4) return false;
  const p = c.profile;
  if (!p || p.upTo > upTo) return true;
  return notes - p.noteCount >= PROFILE_REFRESH;
}

/** Nicknames in the reader's language: from the card, else the saved ones that look right for the language. */
export function aliasesFor(c: NotebookCharacter, lang: 'tr' | 'en', upTo: number): string[] {
  const p = profileFor(c, upTo);
  if (p) return lang === 'tr' ? p.aliasesTr : p.aliasesEn;
  const tr = (a: string) => isTurkishName(a) || /[çğıöşüÇĞİÖŞÜ]/.test(a);
  return c.aliases.filter((a) => (lang === 'tr' ? true : !tr(a))).slice(0, 4);
}

const strings = (v: unknown, max: number) =>
  (Array.isArray(v) ? v : [])
    .filter((x): x is string => typeof x === 'string' && !!x.trim())
    .map((x) => x.trim())
    .slice(0, max);

/** Parse Gemini's cards; keyed by the character's name as it was sent. */
export function parseProfiles(data: any): Record<string, Omit<CharacterProfile, 'upTo' | 'noteCount'>> {
  const out: Record<string, Omit<CharacterProfile, 'upTo' | 'noteCount'>> = {};
  for (const c of Array.isArray(data?.characters) ? data.characters : []) {
    if (typeof c?.name !== 'string' || !c.name.trim()) continue;
    const traitsTr = strings(c.traits_tr, MAX_TRAITS);
    const traitsEn = strings(c.traits_en, MAX_TRAITS);
    if (!traitsTr.length && !traitsEn.length) continue;
    out[c.name.trim()] = {
      traitsTr: traitsTr.length ? traitsTr : traitsEn,
      traitsEn: traitsEn.length ? traitsEn : traitsTr,
      aliasesTr: strings(c.aliases_tr, 4),
      aliasesEn: strings(c.aliases_en, 4),
    };
  }
  return out;
}

// ---- main and side characters ----------------------------------------------------

/** Notes shown for a character without a short card. */
export const MAX_NOTES_SHOWN = 5;
/** A main character is seen in at least this many chapters (up to the reading point)... */
export const MAIN_MIN_CHAPTERS = 5;
/** ...and is among the this many most seen. */
export const MAIN_MAX = 12;

/**
 * Splits the cast at reading point `upTo`: main characters (most seen, most seen first) and
 * side characters (most recently seen first, so the new faces of the last chapters are on top).
 */
export function splitCast<T extends NotebookCharacter>(list: T[], upTo: number): { main: T[]; side: T[] } {
  const seen = (c: T) => c.seenIn.filter((x) => x <= upTo);
  const bySeen = [...list].sort((a, b) => seen(b).length - seen(a).length || a.firstChapter - b.firstChapter);
  const main = bySeen.filter((c) => seen(c).length >= MAIN_MIN_CHAPTERS).slice(0, MAIN_MAX);
  const last = (c: T) => Math.max(c.firstChapter, ...seen(c));
  const side = list.filter((c) => !main.includes(c)).sort((a, b) => last(b) - last(a) || seen(b).length - seen(a).length);
  return { main, side };
}

function renamed(c: NotebookCharacter, name: string): NotebookCharacter {
  const out: NotebookCharacter = { ...c, name, nameTr: undefined, aliases: c.aliases.filter((a) => normName(a) !== normName(name)) };
  addAlias(out, c.name);
  if (c.nameTr) addAlias(out, c.nameTr);
  return out;
}

/** The reader gives a character its main name; a record already under that name is joined in. */
export function renameCharacter(nb: Notebook, name: string, newName: string): Notebook {
  const to = newName.trim();
  const k = nb.characters.findIndex((c) => c.name === name);
  if (k < 0 || !to || to.length > 60) return nb;
  let characters = [...nb.characters];
  let c = characters[k];
  const other = characters.findIndex((x, j) => j !== k && normName(x.name) === normName(to));
  if (other >= 0) {
    c = joinCharacters(c, characters[other], true);
    characters = characters.filter((_, j) => j !== other);
  }
  const at = characters.findIndex((x) => x.name === name);
  characters[at] = { ...(normName(c.name) === normName(to) ? c : renamed(c, to)), pinned: true };
  return { ...nb, characters };
}
