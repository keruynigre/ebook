/**
 * Word lookups for the reader's tap-a-word bubble.
 * English: Google Translate's free dictionary data (Turkish equivalents by part of speech).
 * Turkish: TDK Güncel Türkçe Sözlük, trying shorter stems for inflected words.
 * Either way Gemini (when a key is saved) explains the word in its sentence as a fallback.
 */
import { explainWord } from './gemini';
import { getGeminiKey, getSettings } from './settings';
import { parseGoogleDictionary, parseTdk, turkishStems, type WordMeaning } from './dictionaryParse';

export type { WordMeaning };

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function lookupEnglish(word: string): Promise<WordMeaning | null> {
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=tr&dt=t&dt=bd&q=' + encodeURIComponent(word);
  return parseGoogleDictionary(word, await getJson(url));
}

async function lookupTurkish(word: string): Promise<WordMeaning | null> {
  // At most a handful of requests: the full word, then progressively shorter stems.
  const stems = turkishStems(word).slice(0, 7);
  for (const stem of stems) {
    const json = await getJson('https://sozluk.gov.tr/gts?ara=' + encodeURIComponent(stem)).catch(() => null);
    const found = parseTdk(word, json);
    if (found) return found;
  }
  return null;
}

async function lookupGemini(word: string, sentence: string): Promise<WordMeaning | null> {
  const key = await getGeminiKey();
  const s = getSettings();
  const model = s.geminiModels[0] ?? s.geminiModel;
  if (!key || !model) return null;
  const text = await explainWord(key, model, word, sentence);
  return { word, senses: [{ items: text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3) }], source: 'Gemini' };
}

const cache = new Map<string, Promise<WordMeaning>>();

export function lookupWord(word: string, sentence: string, lang: 'tr' | 'en'): Promise<WordMeaning> {
  const key = `${lang}:${word.toLocaleLowerCase(lang)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async () => {
    let found: WordMeaning | null = null;
    let error: unknown = null;
    try {
      found = lang === 'en' ? await lookupEnglish(word) : await lookupTurkish(word);
    } catch (e) {
      error = e;
    }
    if (!found) {
      try {
        found = await lookupGemini(word, sentence);
      } catch (e) {
        error = e;
      }
    }
    if (found) return found;
    throw new Error(error ? `Anlam bulunamadı (${(error as Error).message}).` : 'Sözlükte bulunamadı.');
  })();
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  return p;
}
