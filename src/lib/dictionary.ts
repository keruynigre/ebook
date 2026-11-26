/**
 * Word lookups for the reader's tap-a-word bubble.
 * English: Google Translate's free dictionary data (Turkish equivalents by part of speech).
 * Turkish: TDK Güncel Türkçe Sözlük, trying shorter stems for inflected words.
 * Either way Gemini (when a key is saved) explains the word in its sentence as a fallback,
 * and when Gemini cannot (daily allowance used up, no key) Google Translate gives the meaning.
 */
import { GeminiError, explainWord } from './gemini';
import { getGeminiKey, getSettings } from './settings';
import { parseGoogleDictionary, parseTdk, turkishStems, type WordMeaning } from './dictionaryParse';

export type { WordMeaning };

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Google Translate's free dictionary data: English → Turkish, or Turkish → English. */
async function lookupGoogle(word: string, from: 'en' | 'tr'): Promise<WordMeaning | null> {
  const to = from === 'en' ? 'tr' : 'en';
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&dt=bd&q=` + encodeURIComponent(word);
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

// After Gemini says its allowance is used up, skip it for a while instead of asking for every word.
let geminiRestUntil = 0;

async function lookupGemini(word: string, sentence: string): Promise<WordMeaning | null> {
  if (Date.now() < geminiRestUntil) return null;
  const key = await getGeminiKey();
  const s = getSettings();
  const model = s.geminiModels[0] ?? s.geminiModel;
  if (!key || !model) return null;
  let text: string;
  try {
    text = await explainWord(key, model, word, sentence);
  } catch (e) {
    if (e instanceof GeminiError && (e.kind === 'daily' || e.kind === 'rate')) geminiRestUntil = Date.now() + (e.kind === 'daily' ? 60 : 2) * 60_000;
    throw e;
  }
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
      found = lang === 'en' ? await lookupGoogle(word, 'en') : await lookupTurkish(word);
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
    // Turkish words TDK does not know (names, rare inflections) and Gemini could not explain: Google's English meaning.
    if (!found && lang === 'tr') {
      try {
        found = await lookupGoogle(word, 'tr');
      } catch (e) {
        error ??= e;
      }
    }
    if (found) return found;
    throw new Error(error ? `Anlam bulunamadı (${(error as Error).message}).` : 'Sözlükte bulunamadı.');
  })();
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  return p;
}
