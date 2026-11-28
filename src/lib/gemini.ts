import { fetchWithTimeout } from './text';
import { parseChapterInfo, type ChapterInfo } from './notebookCore';
import type { ChapterContent } from './types';

/**
 * Translation with Google's Gemini API, using the person's own API key.
 * https://ai.google.dev/api — the key is sent in the x-goog-api-key header.
 */

const API = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate' | 'daily' | 'busy' | 'blocked' | 'invalid' | 'unsupported' | 'other',
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
  let text: string;
  try {
    // Long chapters can take a few minutes to translate, but not forever.
    ({ res, body: text } = await fetchWithTimeout(
      `${API}/${path}`,
      { ...init, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key, ...(init?.headers ?? {}) } },
      init?.method === 'POST' ? 300_000 : 30_000,
      (r) => r.text(),
    ));
  } catch (e) {
    throw new GeminiError(`Gemini'ye bağlanılamadı: ${(e as Error).message}`, 'busy');
  }
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (res.ok) return body as T;

  const message: string = body?.error?.message ?? `HTTP ${res.status}`;
  if (res.status === 400 && /api key/i.test(message)) throw new GeminiError('API anahtarı geçersiz.', 'auth');
  // Retired or unknown model ("no longer available to new users", 404): use another one.
  if (res.status === 404 || /no longer available|not found|is not supported for generatecontent|deprecated|has been retired/i.test(message)) {
    throw new GeminiError(`Model kullanılamıyor: ${message}`, 'unsupported');
  }
  if (res.status === 400) {
    // The model rejected part of the request (an option it does not support).
    const detail = (body?.error?.details ?? [])
      .flatMap((d: any) => d?.fieldViolations ?? [])
      .map((v: any) => [v?.field, v?.description].filter(Boolean).join(': '))
      .filter(Boolean)
      .join('; ');
    throw new GeminiError(`Gemini isteği kabul etmedi: ${message}${detail ? ` (${detail})` : ''}`, 'invalid');
  }
  if (res.status === 401 || res.status === 403) throw new GeminiError(`API anahtarı reddedildi: ${message}`, 'auth');
  if (res.status === 429) {
    const details: any[] = body?.error?.details ?? [];
    const retry = details.find((d) => typeof d?.retryDelay === 'string')?.retryDelay as string | undefined;
    const retryMs = retry ? Math.ceil(parseFloat(retry) * 1000) : undefined;
    const daily = /per ?day|daily|PerDay/i.test(JSON.stringify(details) + message);
    if (daily) throw new GeminiError('Gemini günlük kullanım hakkı doldu. Yarın devam edebilir ya da başka bir model seçebilirsiniz.', 'daily');
    throw new GeminiError('Gemini dakikalık sınırı aşıldı, biraz bekleniyor…', 'rate', retryMs);
  }
  // Temporary overload on Google's side ("high demand", "overloaded", 503/500/504).
  if (res.status === 500 || res.status === 503 || res.status === 504 || /high demand|overloaded|unavailable|try again later/i.test(message)) {
    throw new GeminiError('Gemini şu an çok yoğun (geçici bir durum).', 'busy');
  }
  throw new GeminiError(`Gemini hatası: ${message}`, 'other');
}

/** Short meaning of a word as used in a sentence, in Turkish (for the reader's word bubble). */
export async function explainWord(key: string, model: string, word: string, sentence: string): Promise<string> {
  const modelPath = model.startsWith('models/') ? model : `models/${model}`;
  const prompt =
    `Cümle: "${sentence}"\n\nBu cümledeki "${word}" sözcüğünün buradaki anlamını Türkçe olarak en fazla iki kısa satırla açıkla. ` +
    'Sözcük çekimliyse önce kökünü yaz (ör. "kök: …"). Özel isimse kim/ne olduğunu söyle. Başka bir şey yazma.';
  const r = await call<any>(key, `${modelPath}:generateContent`, {
    method: 'POST',
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 160 },
    }),
  });
  const text: string = (r?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('').trim();
  if (!text) throw new GeminiError('Gemini yanıt vermedi.', 'other');
  return text;
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

/** Request shapes from richest to plainest; a model gets the first one it accepts. */
const REQUEST_LEVELS = [
  { noThinking: true, safety: true, schema: true, json: true, system: true },
  { noThinking: false, safety: true, schema: true, json: true, system: true },
  { noThinking: false, safety: false, schema: true, json: true, system: true },
  { noThinking: false, safety: false, schema: false, json: true, system: true },
  { noThinking: false, safety: false, schema: false, json: false, system: true },
  { noThinking: false, safety: false, schema: false, json: false, system: false },
];
/** Index into REQUEST_LEVELS that last worked for each model. */
const requestLevel = new Map<string, number>();

export interface GlossaryEntry {
  source: string;
  target: string;
}

export interface TranslationResult {
  chapter: ChapterContent;
  newTerms: GlossaryEntry[];
  /** Summary and character facts for the story notebook. */
  info: ChapterInfo;
}

/** The person's translation instructions (editable in Settings). */
export const DEFAULT_TRANSLATION_PROMPT = `Sen; akademik, teknik ve edebi metinler konusunda uzmanlaşmış, yüksek düzeyde dil yetkinliğine sahip profesyonel bir mütercim-tercümansın. Görevin, sana iletilen her türlü metni veya dosyayı en yüksek doğrulukla Türkçeye çevirmektir.

Çeviri Prensipleri:
Tam Metin Sadakati: En temel kuralın "sıfır kayıp" ilkesidir. Metnin hiçbir bölümünü atlamayacak, özetlemeyecek veya "burası benzer" diyerek geçiştirmeyeceksin. Başlıklardan dipnotlara kadar metnin TAMAMINI çevireceksin. Çevirmediğin tek bir cümle dahi kalmayacak.

Terminoloji Hassasiyeti:
Metnin ait olduğu disiplini (hukuk, felsefe, ilahiyat, teknoloji vb.) analiz et ve o alana ait yerleşik terminolojiyi kullan. Eğer bir terimin birden fazla anlamı varsa, bağlama en uygun olanı seç.

Akıcılık ve Doğallık:
Çeviri yaparken Türkçe'nin söz dizimine, deyim yapısına ve ifade gücüne uygun, akıcı ve profesyonel bir üslup kullan.

Format Koruma:
Orijinal metindeki madde işaretleri, kalın/italik yazımlar veya tablo yapılarını aynen koru.

Operasyonel Kurallar:
Anlamı belirsiz veya birden fazla şekilde yorumlanabilecek ifadeler olursa, en makul çeviriyi yap ama parantez içinde veya çeviri sonunda kısa bir "Not" olarak alternatifini belirt.

Dipnotlar Hakkında:
Eğer verilen metinde dipnotlar varsa onların da tamamı tercüme edilecek. Hiçbir dipnot atlanmayacak. Dipnot numaraları birebir korunacak.`;

/** Rules the app needs to read the answer; always added after the person's instructions. */
const APP_RULES = `Uygulama kuralları (yanıtın okunabilmesi için zorunlu):
- Metin bir romanın bölümüdür ve JSON olarak verilir: "title" (bölüm başlığı) ve "paragraphs" (paragraflar).
- Her paragrafı ayrı çevir; paragraf sayısı ve sırası aynı kalsın. "***" gibi ayraçları aynen bırak.
- Karakter ve yer adlarını kitap boyunca aynı yaz; sözlükte verilen terimleri her zaman sözlükteki karşılığıyla kullan.
- Çeviri sonuna eklenecek notları paragrafların içine değil "notes" listesine yaz (her not kısa bir cümle). Not yoksa boş liste ver.
- Bu bölümde ilk kez geçen ve tutarlı çevrilmesi gereken özel terimleri (unvanlar, teknik adları, seviye adları, eşya adları) "newTerms" listesine ekle. Kişi adlarını ekleme.
- "summary": bölümün 2-4 cümlelik Türkçe özeti (ne oldu, kim ne yaptı); "summary_en": aynı özetin İngilizcesi.
- "characters": bu bölümde görünen ya da konuşan önemli karakterler, her kişi için TEK kayıt. "name": karakterin özgün adı (pinyin, ör. "Chu Yang"; bilinen karakterlerdeki kişiyse listedeki ana adı aynen kullan); adı hiç bilinmeyenler için kısa İngilizce tanım (ör. "Tie Zhu's Father"). Kişinin adı biliniyorsa (bu bölümde ya da listede) tanım yerine adını yaz. "aliases": aynı kişinin bu bölümde geçen diğer adları, lakapları ve tanımları (ör. Wang Lin için "Tie Zhu"; Wang Tianshui için "Tie Zhu's Father", "Lao Er"); lakap ya da tanım ayrı bir karakter değildir. "name_tr": ana adın Türkçe metindeki hali (özel adlar aynı kalır; ör. "Tie Zhu'nun Babası"). "description": bu bölümde öğrenilen kalıcı bilgiler (görünüş, yaş, kimlik, unvan, yetenek, ilişkiler), kısa ve Türkçe; "description_en": aynı bilginin İngilizcesi. Yeni bilgi yoksa ikisini de boş bırak.
- Yanıtı yalnızca istenen JSON biçiminde ver.`;

/** Translates one chapter to Turkish. `glossary` keeps terms consistent across chapters. */
export async function translateChapter(
  key: string,
  model: string,
  chapter: ChapterContent,
  glossary: GlossaryEntry[],
  bookTitle: string,
  instructions: string = DEFAULT_TRANSLATION_PROMPT,
  knownCharacters: string[] = [],
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

Bilinen karakterler (ana ad, parantez içinde diğer adları): ${knownCharacters.join('; ') || '(henüz yok)'}

Aşağıdaki JSON'daki bölüm başlığını ve paragrafların tamamını Türkçeye çevir.

${JSON.stringify(input)}`;

  const system = `${instructions.trim() || DEFAULT_TRANSLATION_PROMPT}\n\n${APP_RULES}`;
  const schema = {
    type: 'OBJECT',
    properties: {
      title: { type: 'STRING' },
      paragraphs: { type: 'ARRAY', items: { type: 'STRING' } },
      notes: { type: 'ARRAY', items: { type: 'STRING' } },
      newTerms: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { source: { type: 'STRING' }, target: { type: 'STRING' } },
          required: ['source', 'target'],
        },
      },
      summary: { type: 'STRING' },
      summary_en: { type: 'STRING' },
      characters: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { name: { type: 'STRING' }, name_tr: { type: 'STRING' }, aliases: { type: 'ARRAY', items: { type: 'STRING' } }, description: { type: 'STRING' }, description_en: { type: 'STRING' } },
          required: ['name', 'name_tr', 'aliases', 'description', 'description_en'],
        },
      },
    },
    // Optional fields are often left out of structured answers, so ask for all of them.
    required: ['title', 'paragraphs', 'notes', 'newTerms', 'summary', 'summary_en', 'characters'],
  };
  const jsonHint =
    '\n\nYanıt biçimi: {"title": string, "paragraphs": string[], "notes": string[], "newTerms": [{"source": string, "target": string}], "summary": string, "summary_en": string, "characters": [{"name": string, "name_tr": string, "aliases": string[], "description": string, "description_en": string}]}';

  const modelPath = model.startsWith('models/') ? model : `models/${model}`;
  // Models differ in which options they accept. Start with the full request and drop
  // options one by one when the model rejects them; remember what worked per model.
  let r: any;
  for (let level = requestLevel.get(modelPath) ?? 0; ; level++) {
    if (level >= REQUEST_LEVELS.length) {
      throw new GeminiError(`${modelPath.replace(/^models\//, '')} bu çeviri isteğini desteklemiyor.`, 'unsupported');
    }
    const o = REQUEST_LEVELS[level];
    const generationConfig: Record<string, unknown> = { temperature: 0.4 };
    if (o.json) generationConfig.responseMimeType = 'application/json';
    if (o.schema) generationConfig.responseSchema = schema;
    if (o.noThinking) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    const userText = (o.system ? prompt : `${system}\n\n---\n\n${prompt}`) + (o.schema ? '' : jsonHint);
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig,
    };
    if (o.system) body.systemInstruction = { parts: [{ text: system }] };
    if (o.safety) {
      body.safetySettings = [
        'HARM_CATEGORY_HARASSMENT',
        'HARM_CATEGORY_HATE_SPEECH',
        'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        'HARM_CATEGORY_DANGEROUS_CONTENT',
      ].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' }));
    }
    try {
      r = await call<any>(key, `${modelPath}:generateContent`, { method: 'POST', body: JSON.stringify(body) });
      requestLevel.set(modelPath, level);
      break;
    } catch (e) {
      if (e instanceof GeminiError && e.kind === 'invalid') continue;
      throw e;
    }
  }
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
    const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    data = JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
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
  const notes: string[] = Array.isArray(data?.notes)
    ? data.notes.filter((n: unknown) => typeof n === 'string' && n.trim()).map((n: string) => n.trim())
    : [];
  const title = typeof data?.title === 'string' && data.title.trim() ? data.title.trim() : original.title;
  return {
    chapter: notes.length ? { title, paragraphs, notes } : { title, paragraphs },
    newTerms,
    info: parseChapterInfo(data),
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

/** One JSON answer from Gemini, trying plainer request shapes when a model rejects an option. */
export async function generateJson(key: string, model: string, system: string, prompt: string, schema: object, hint: string): Promise<any> {
  const modelPath = model.startsWith('models/') ? model : `models/${model}`;
  let r: any;
  for (let level = requestLevel.get(modelPath) ?? 0; ; level++) {
    if (level >= REQUEST_LEVELS.length) throw new GeminiError(`${modelPath.replace(/^models\//, '')} bu isteği desteklemiyor.`, 'unsupported');
    const o = REQUEST_LEVELS[level];
    const generationConfig: Record<string, unknown> = { temperature: 0.3 };
    if (o.json) generationConfig.responseMimeType = 'application/json';
    if (o.schema) generationConfig.responseSchema = schema;
    if (o.noThinking) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: (o.system ? prompt : `${system}\n\n---\n\n${prompt}`) + (o.schema ? '' : hint) }] }],
      generationConfig,
    };
    if (o.system) body.systemInstruction = { parts: [{ text: system }] };
    try {
      r = await call<any>(key, `${modelPath}:generateContent`, { method: 'POST', body: JSON.stringify(body) });
      requestLevel.set(modelPath, level);
      break;
    } catch (e) {
      if (e instanceof GeminiError && e.kind === 'invalid') continue;
      throw e;
    }
  }
  const text: string = (r?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
  try {
    const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    const a = cleaned.indexOf('{');
    const b = cleaned.lastIndexOf('}');
    return JSON.parse(a >= 0 && b > a ? cleaned.slice(a, b + 1) : cleaned);
  } catch {
    throw new GeminiError('Gemini anlaşılır bir yanıt döndürmedi.', 'other');
  }
}

const ANALYZE_SYSTEM = `Bir romanın bölümlerini okuyup okuyucu için "hikâye defteri" tutuyorsun. Her bölüm için:
- "summary": 2-4 cümlelik Türkçe özet (ne oldu, kim ne yaptı); "summary_en": aynı özetin İngilizcesi. Sonraki bölümlerden bilgi ekleme.
- "characters": bölümde görünen ya da konuşan önemli karakterler, her kişi için TEK kayıt. "name": karakterin özgün adı (pinyin, ör. "Chu Yang"; bilinen karakterlerdeki kişiyse listedeki ana adı aynen kullan); adı hiç bilinmeyenler için kısa İngilizce tanım (ör. "Tie Zhu's Father"), asla Türkçe değil. Kişinin adı biliniyorsa tanım yerine adını yaz. "aliases": aynı kişinin bölümde geçen diğer adları, lakapları ve tanımları (ör. Wang Lin için "Tie Zhu"; Wang Tianshui için "Tie Zhu's Father", "Lao Er"); lakap ya da tanım ayrı bir karakter değildir. "name_tr": ana adın Türkçesi (özel adlar aynı kalır; ör. "Tie Zhu'nun Babası"). "description": bu bölümde öğrenilen kalıcı bilgiler (görünüş, yaş, kimlik, unvan, yetenek, ilişkiler), kısa ve Türkçe; "description_en": aynı bilginin İngilizcesi. Yeni bilgi yoksa ikisini de boş bırak.
"summary" ve "description" her zaman Türkçe, "summary_en" ve "description_en" her zaman İngilizce olsun; bölümün dili ne olursa olsun.
Yanıtı yalnızca istenen JSON biçiminde ver.`;

/** Summaries and character facts for chapters read before the notebook existed. */
export async function analyzeChapters(
  key: string,
  model: string,
  chapters: { index: number; title: string; paragraphs: string[] }[],
  knownCharacters: string[],
  bookTitle: string,
): Promise<{ index: number; info: ChapterInfo }[]> {
  const prompt = `Roman: ${bookTitle}
Bilinen karakterler (ana ad, parantez içinde diğer adları): ${knownCharacters.slice(0, 150).join('; ') || '(henüz yok)'}

Bölümler (JSON):
${JSON.stringify(chapters.map((c) => ({ index: c.index, title: c.title, text: c.paragraphs.join('\n') })))}`;
  const schema = {
    type: 'OBJECT',
    properties: {
      chapters: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            index: { type: 'INTEGER' },
            summary: { type: 'STRING' },
            summary_en: { type: 'STRING' },
            characters: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: { name: { type: 'STRING' }, name_tr: { type: 'STRING' }, aliases: { type: 'ARRAY', items: { type: 'STRING' } }, description: { type: 'STRING' }, description_en: { type: 'STRING' } },
                required: ['name', 'name_tr', 'aliases', 'description', 'description_en'],
              },
            },
          },
          required: ['index', 'summary', 'summary_en', 'characters'],
        },
      },
    },
    required: ['chapters'],
  };
  const hint = '\n\nYanıt biçimi: {"chapters": [{"index": number, "summary": string, "summary_en": string, "characters": [{"name": string, "name_tr": string, "aliases": string[], "description": string, "description_en": string}]}]}';
  const data = await generateJson(key, model, ANALYZE_SYSTEM, prompt, schema, hint);
  const wanted = new Set(chapters.map((c) => c.index));
  return (Array.isArray(data?.chapters) ? data.chapters : [])
    .filter((c: any) => Number.isInteger(c?.index) && wanted.has(c.index))
    .map((c: any) => ({ index: c.index as number, info: parseChapterInfo(c) }));
}

/** Groups of notebook characters that are the same person; the first name of each group is the one to keep. */
export async function findSameCharacters(
  key: string,
  model: string,
  characters: { name: string; aliases: string[]; note: string }[],
  bookTitle: string,
): Promise<string[][]> {
  const system = `Bir romanın karakter listesindeki tekrarları buluyorsun. Aynı kişinin farklı adlarla (gerçek adı, lakabı, "X's Father" gibi tanımı) ayrı kaydedildiği grupları ver.
Her grubun ilk adı tutulacak ana ad olsun: kişinin gerçek adı (pinyin) varsa o, yoksa en açık tanım. Takma kimlik, kılık değiştirmiş ad ya da unvan asla ana ad olmaz (ör. ana karakter bir süre başka adla dolaşıyorsa ana ad yine gerçek adıdır). Bir kaydın ana adı böyle bir takma adsa ve gerçek adı aliases içinde geçiyorsa, o kaydı tek başına da olsa gerçek adı önde olacak şekilde grup olarak ver (ör. ["Gerçek Ad", "Takma Ad"]). Yalnızca notlardan ve adlardan emin olduğun eşleşmeleri ver; emin değilsen gruplama. Tekrar yoksa boş liste ver.
Adları listede yazıldığı gibi aynen kullan. Yanıtı yalnızca istenen JSON biçiminde ver.`;
  const prompt = `Roman: ${bookTitle}

Karakterler (JSON):
${JSON.stringify(characters.map((c) => ({ name: c.name, aliases: c.aliases, note: c.note.slice(0, 200) })))}`;
  const schema = {
    type: 'OBJECT',
    properties: { groups: { type: 'ARRAY', items: { type: 'ARRAY', items: { type: 'STRING' } } } },
    required: ['groups'],
  };
  const data = await generateJson(key, model, system, prompt, schema, '\n\nYanıt biçimi: {"groups": [[string, string, ...]]}');
  return (Array.isArray(data?.groups) ? data.groups : [])
    .filter((g: unknown) => Array.isArray(g))
    .map((g: unknown[]) => g.filter((n): n is string => typeof n === 'string' && !!n.trim()))
    .filter((g: string[]) => g.length >= 2);
}

/** Short cards for characters: at most five telling traits and the nicknames, in Turkish and English. */
export async function profileCharacters(
  key: string,
  model: string,
  bookTitle: string,
  characters: { name: string; aliases: string[]; notes: string[] }[],
): Promise<any> {
  const system = `You keep the character list of a novel short and useful for a reader.
For each character, using ONLY the notes given (never knowledge of later events), write:
- traits_tr / traits_en: at most 5 of the most defining facts, most important first: who they are (role, sect, family), their relation to the main character, look, power or cultivation level, personality. Each trait 2-8 words, no full sentences, no chapter events.
- aliases_tr / aliases_en: at most 4 nicknames or titles, Turkish in aliases_tr ("Genç Efendi Tian"), English in aliases_en ("Young Master Tian"). Personal names (pinyin) stay the same in both and are not repeated as nicknames.
Use the names exactly as given. Answer only with the requested JSON.`;
  const prompt = `Novel: ${bookTitle}\n\nCharacters (JSON):\n${JSON.stringify(characters)}`;
  const list = { type: 'ARRAY', items: { type: 'STRING' } };
  const schema = {
    type: 'OBJECT',
    properties: {
      characters: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { name: { type: 'STRING' }, traits_tr: list, traits_en: list, aliases_tr: list, aliases_en: list },
          required: ['name', 'traits_tr', 'traits_en'],
        },
      },
    },
    required: ['characters'],
  };
  return generateJson(
    key,
    model,
    system,
    prompt,
    schema,
    '\n\nAnswer format: {"characters": [{"name": string, "traits_tr": [string], "traits_en": [string], "aliases_tr": [string], "aliases_en": [string]}]}',
  );
}
