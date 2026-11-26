/** Finding a word or phrase inside a chapter's paragraphs (pure, testable). */

export interface SearchHit {
  para: number;
  /** A short piece of the paragraph around the match, and where the match sits in it. */
  snippet: string;
  start: number;
  length: number;
}

const fold = (s: string, lang: 'tr' | 'en') => s.toLocaleLowerCase(lang === 'tr' ? 'tr' : 'en');

/** Every paragraph containing `query` (case-insensitive), with a snippet of about `around` characters each side. */
export function searchParagraphs(paragraphs: string[], query: string, lang: 'tr' | 'en', around = 60): SearchHit[] {
  const q = fold(query.trim(), lang);
  if (q.length < 2) return [];
  const hits: SearchHit[] = [];
  paragraphs.forEach((p, para) => {
    const at = fold(p, lang).indexOf(q);
    if (at < 0) return;
    // Lower-casing can change length (rarely); keep the indexes inside the text.
    const from = Math.max(0, at - around);
    const to = Math.min(p.length, at + q.length + around);
    let snippet = p.slice(from, to);
    let start = at - from;
    if (from > 0) {
      snippet = `…${snippet}`;
      start += 1;
    }
    if (to < p.length) snippet = `${snippet}…`;
    hits.push({ para, snippet, start, length: q.length });
  });
  return hits;
}
