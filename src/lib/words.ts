const WORD = /[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu;

/** Split a paragraph into words (tappable) and the text between them. */
export function tokenize(text: string): { text: string; start: number; word: boolean }[] {
  const out: { text: string; start: number; word: boolean }[] = [];
  let at = 0;
  for (const m of text.matchAll(WORD)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ text: text.slice(at, i), start: at, word: false });
    out.push({ text: m[0], start: i, word: true });
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), start: at, word: false });
  return out;
}
