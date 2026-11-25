/** Pure parsers for the word lookups (kept free of React Native for tests). */

export interface WordMeaning {
  word: string;
  /** Headword actually found (the stem, for inflected Turkish words). */
  headword?: string;
  /** Main translation (English words). */
  translation?: string;
  /** Grouped senses, e.g. { label: 'isim', items: ['köy', 'kasaba'] }. */
  senses: { label?: string; items: string[] }[];
  source: string;
}

const POS_TR: Record<string, string> = {
  noun: 'isim',
  verb: 'fiil',
  adjective: 'sıfat',
  adverb: 'zarf',
  pronoun: 'zamir',
  preposition: 'edat',
  conjunction: 'bağlaç',
  interjection: 'ünlem',
  abbreviation: 'kısaltma',
  phrase: 'deyim',
  prefix: 'ön ek',
  suffix: 'son ek',
  article: 'tanımlık',
};

/** Parse Google's translate_a/single response (dt=t & dt=bd). */
export function parseGoogleDictionary(word: string, json: unknown): WordMeaning | null {
  if (!Array.isArray(json)) return null;
  const translation = Array.isArray(json[0])
    ? (json[0] as unknown[])
        .map((x) => (Array.isArray(x) && typeof x[0] === 'string' ? x[0] : ''))
        .join('')
        .trim()
    : '';
  const senses: WordMeaning['senses'] = [];
  if (Array.isArray(json[1])) {
    for (const entry of json[1] as unknown[]) {
      if (!Array.isArray(entry)) continue;
      const pos = typeof entry[0] === 'string' ? entry[0] : '';
      const terms = Array.isArray(entry[1]) ? (entry[1] as unknown[]).filter((t): t is string => typeof t === 'string') : [];
      if (terms.length) senses.push({ label: POS_TR[pos] ?? pos, items: terms.slice(0, 6) });
    }
  }
  if (!translation && !senses.length) return null;
  const same = translation.toLocaleLowerCase('tr') === word.toLocaleLowerCase('en');
  if (same && !senses.length) return null;
  return { word, translation: same ? undefined : translation, senses, source: 'Google Çeviri' };
}

/** Parse a TDK /gts response. */
export function parseTdk(word: string, json: unknown): WordMeaning | null {
  if (!Array.isArray(json) || !json.length) return null;
  const senses: WordMeaning['senses'] = [];
  let headword: string | undefined;
  for (const madde of json as any[]) {
    headword ??= typeof madde?.madde === 'string' ? madde.madde : undefined;
    for (const a of (madde?.anlamlarListe ?? []) as any[]) {
      const text = typeof a?.anlam === 'string' ? a.anlam.trim() : '';
      if (!text) continue;
      const label = (a?.ozelliklerListe ?? [])
        .map((o: any) => o?.tam_adi)
        .filter((x: unknown): x is string => typeof x === 'string')
        .slice(0, 2)
        .join(', ');
      senses.push({ label: label || undefined, items: [text] });
      if (senses.length >= 5) break;
    }
    if (senses.length >= 5) break;
  }
  if (!senses.length) return null;
  return { word, headword, senses, source: 'TDK Sözlük' };
}

/** "Yağlarıyla" → candidates from the full word down to a 3-letter stem. */
export function turkishStems(word: string): string[] {
  const w = word.toLocaleLowerCase('tr').replace(/['’].*$/, '');
  const out: string[] = [];
  for (let n = w.length; n >= Math.min(3, w.length); n--) out.push(w.slice(0, n));
  return out;
}
