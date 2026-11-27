/** A chapter as listed on the novel's table of contents. */
export interface ChapterRef {
  title: string;
  url: string;
}

/** What a source returns when it reads a novel's main page. */
export interface NovelInfo {
  sourceId: string;
  url: string;
  title: string;
  author?: string;
  description?: string;
  coverUrl?: string;
  /** BCP 47 language tag of the text, e.g. "en". */
  language?: string;
  chapters: ChapterRef[];
}

/** The cleaned text of one chapter. */
export interface ChapterContent {
  title: string;
  paragraphs: string[];
  /** Translator's notes shown after the chapter (alternatives for ambiguous phrases). */
  notes?: string[];
}

/** A novel saved in the library. */
export interface Book {
  id: string;
  sourceId: string;
  url: string;
  title: string;
  author: string;
  description: string;
  language: string;
  chapters: ChapterRef[];
  /** 0-based indexes of chapters stored on the device. */
  downloaded: number[];
  /** 0-based indexes of chapters with a Turkish translation on the device. */
  translated?: number[];
  /** Where the person stopped reading: chapter index and scroll position (0–1). */
  progress?: { index: number; position: number; updatedAt: number };
  /** Scroll position (0–1) per chapter index, so every chapter reopens where it was left. */
  positions?: Record<number, number>;
  /** Words and furthest point reached per chapter index (see readStats.ts). */
  readStats?: Record<number, { words: number; read: number }>;
  /** Set once chapters read before statistics existed have been counted. */
  readStatsBackfilled?: boolean;
  /** File name of the cover inside the book folder, if any. */
  coverFile?: string;
  /** The cover was drawn by AI (no cover came with the book). */
  coverAi?: boolean;
  addedAt: number;
  updatedAt: number;
}

/** Network access used by sources. Implementations may go through a WebView. */
export interface Http {
  getText(url: string): Promise<string>;
  getBytes(url: string): Promise<Uint8Array>;
}
