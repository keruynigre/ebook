import type { ChapterContent } from './types';

/**
 * Translation with Google's Gemini API, using the person's own API key.
 * https://ai.google.dev/api — the key is sent in the x-goog-api-key header.
 */

const API = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate' | 'daily' | 'blocked' | 'other',
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export interface GeminiModel {
  /** e.g. "models/gemini-…-flash" */
  name: string;
  displayName: string;
}

async function call<T>(key: string, path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}/${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key, ...(init?.headers ?? {}) },
    });
  } catch (e) {
    throw new GeminiError(`Gemini'ye bağlanılamadı: ${(e as Error).message}`, 'other');
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (res.ok) return body as T;

  const message: string = body?.error?.message ?? `HTTP ${res.status}`;
  if (res.status === 400 && /api key/i.test(message)) throw new GeminiError('API anahtarı geçersiz.', 'auth');
  if (res.status === 401 || res.status === 403) throw new GeminiError(`API anahtarı reddedildi: ${message}`, 'auth');
  if (res.status === 429) {
    const details: any[] = body?.error?.details ?? [];
    const retry = details.find((d) => typeof d?.retryDelay === 'string')?.retryDelay as string | undefined;
    const retryMs = retry ? Math.ceil(parseFloat(retry) * 1000) : undefined;
    const daily = /per ?day|daily|PerDay/i.test(JSON.stringify(details) + message);
    if (daily) throw new GeminiError('Gemini günlük kullanım hakkı doldu. Yarın devam edebilir ya da başka bir model seçebilirsiniz.', 'daily');
    throw new GeminiError('Gemini dakikalık sınırı aşıldı, biraz bekleniyor…', 'rate', retryMs);
  }
  throw new GeminiError(`Gemini hatası: ${message}`, 'other');
}

/** Models this key can use for text generation, most suitable first. */
export async function listModels(key: string): Promise<GeminiModel[]> {
  const out: GeminiModel[] = [];
  let pageToken = '';
  for (let page = 0; page < 5; page++) {
    const r = await call<{ models?: any[]; nextPageToken?: string }>(
      key,
      `models?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
    );
    for (const m of r.models ?? []) {
      const methods: string[] = m.supportedGenerationMethods ?? [];
      const name: string = m.name ?? '';
      if (!methods.includes('generateContent') || !/gemini/i.test(name)) continue;
      if (/image|tts|audio|embedding|vision|live|robotics|computer/i.test(name)) continue;
      out.push({ name, displayName: m.displayName ?? name.replace(/^models\//, '') });
    }
    if (!r.nextPageToken) break;
    pageToken = r.nextPageToken;
  }
  const score = (m: GeminiModel) => {
    const n = m.name.toLowerCase();
    let s = 0;
    if (n.includes('flash')) s += 10; // fast and has a free tier
    if (n.includes('lite')) s -= 3;
    if (/preview|exp/.test(n)) s -= 4;
    if (n.includes('latest')) s += 1;
    const v = n.match(/gemini-(\d+(?:\.\d+)?)/);
    if (v) s += parseFloat(v[1]);
    return s;
  };
  return out.sort((a, b) => score(b) - score(a));
}

export interface GlossaryEntry {
  source: string;
  target: string;
}

export interface TranslationResult {
  chapter: ChapterContent;
  newTerms: GlossaryEntry[];
}

const SYSTEM = `Sen deneyimli bir edebi çevirmensin. Web romanlarını İngilizceden (veya verilen dilden) akıcı, doğal ve edebi bir Türkçeye çeviriyorsun.

Kurallar:
- Anlamı ve üslubu koru; birebir değil, Türk okurun doğal bulacağı şekilde çevir.
- Karakter, yer ve tarikat adlarını çevirme; olduğu gibi bırak (ör. "Lin Feng").
- Sözlükte verilen terimleri her zaman sözlükteki karşılığıyla kullan.
- Diyalogları Türkçe yazım kurallarına uygun yaz; konuşmaları tırnak içinde tut.
- Her paragrafı ayrı çevir; paragraf sayısı ve sırası aynı kalsın. "***" gibi ayraçları aynen bırak.
- Açıklama, not veya özet ekleme; sansürleme, kısaltma.
- Ayrıca bu bölümde ilk kez geçen ve tutarlı çevrilmesi gereken özel terimleri (unvanlar, teknik adları, seviye adları, eşya adları) "newTerms" listesine ekle. Kişi adlarını ekleme.`;

/** Translates one chapter to Turkish. `glossary` keeps terms consistent across chapters. */
export async function translateChapter(
  key: string,
  model: string,
  chapter: ChapterContent,
  glossary: GlossaryEntry[],
  bookTitle: string,
): Promise<TranslationResult> {
  const glossaryText = glossary.length
    ? glossary
        .slice(-300)
        .map((g) => `${g.source} => ${g.target}`)
        .join('\n')
    : '(henüz yok)';
  const input = {
    title: chapter.title,
    paragraphs: chapter.paragraphs,
  };
  const prompt = `Roman: ${bookTitle}

Sözlük (kaynak => Türkçe):
${glossaryText}

Aşağıdaki JSON'daki bölüm başlığını ve paragrafları Türkçeye çevir. Yanıtı yalnızca istenen JSON biçiminde ver.

${JSON.stringify(input)}`;

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          paragraphs: { type: 'ARRAY', items: { type: 'STRING' } },
          newTerms: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { source: { type: 'STRING' }, target: { type: 'STRING' } },
              required: ['source', 'target'],
            },
          },
        },
        required: ['title', 'paragraphs'],
      },
    },
    safetySettings: [
      'HARM_CATEGORY_HARASSMENT',
      'HARM_CATEGORY_HATE_SPEECH',
      'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      'HARM_CATEGORY_DANGEROUS_CONTENT',
    ].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' })),
  };

  const modelPath = model.startsWith('models/') ? model : `models/${model}`;
  const r = await call<any>(key, `${modelPath}:generateContent`, { method: 'POST', body: JSON.stringify(body) });
  const cand = r?.candidates?.[0];
  if (!cand || cand.finishReason === 'SAFETY' || r?.promptFeedback?.blockReason) {
    throw new GeminiError('Gemini bu bölümü güvenlik filtresi nedeniyle çevirmedi.', 'blocked');
  }
  const text: string = (cand.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
  return parseTranslation(text, chapter, cand.finishReason);
}

export function parseTranslation(text: string, original: ChapterContent, finishReason?: string): TranslationResult {
  let data: any;
  try {
    data = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    if (finishReason === 'MAX_TOKENS') throw new GeminiError('Bölüm çok uzun, çeviri yarıda kesildi.', 'other');
    throw new GeminiError('Gemini anlaşılır bir çeviri döndürmedi.', 'other');
  }
  const paragraphs: string[] = Array.isArray(data?.paragraphs)
    ? data.paragraphs.filter((p: unknown) => typeof p === 'string' && p.trim()).map((p: string) => p.trim())
    : [];
  if (paragraphs.length === 0) throw new GeminiError('Gemini boş çeviri döndürdü.', 'other');
  // A much shorter result usually means the model skipped text.
  if (paragraphs.length < original.paragraphs.length * 0.6) {
    throw new GeminiError('Çeviri eksik geldi (paragrafların bir kısmı atlanmış).', 'other');
  }
  const newTerms: GlossaryEntry[] = Array.isArray(data?.newTerms)
    ? data.newTerms
        .filter((t: any) => typeof t?.source === 'string' && typeof t?.target === 'string' && t.source.trim() && t.target.trim())
        .map((t: any) => ({ source: t.source.trim(), target: t.target.trim() }))
    : [];
  return {
    chapter: { title: typeof data?.title === 'string' && data.title.trim() ? data.title.trim() : original.title, paragraphs },
    newTerms,
  };
}

/** Adds new terms without changing ones already decided. */
export function mergeGlossary(glossary: GlossaryEntry[], add: GlossaryEntry[]): GlossaryEntry[] {
  const seen = new Set(glossary.map((g) => g.source.toLowerCase()));
  const out = [...glossary];
  for (const t of add) {
    const k = t.source.toLowerCase();
    if (seen.has(k) || t.source.length > 60) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}
