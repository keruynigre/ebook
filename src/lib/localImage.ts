/**
 * Drawing on the person's own computer: Unsloth Studio (or any server with the
 * OpenAI images API) on the same Wi-Fi, e.g. http://192.168.1.20:8888.
 */
import { File } from 'expo-file-system';

import { CloudflareError } from './cloudflare';
import { multipartBody } from './multipart';
import { fetchWithTimeout } from './text';

/** The model Unsloth shows in its example; with "switch model on request" on, Unsloth loads it by itself. */
export const LOCAL_MODEL = 'unsloth/FLUX.2-klein-4B-GGUF';
const TIMEOUT = 300_000;

/** "192.168.1.20:8888" → "http://192.168.1.20:8888" (no trailing slash, no /v1). */
export function normalizeBase(url: string): string {
  let u = url.trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
  if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u;
}

// Servers that answered "no such endpoint" for pictures with references: draw from text only.
const noEdits = new Set<string>();

async function call(base: string, key: string, path: string, init: RequestInit): Promise<any> {
  let res: Response;
  let text: string;
  try {
    ({ res, body: text } = await fetchWithTimeout(
      `${base}${path}`,
      { ...init, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(init.headers ?? {}) } },
      TIMEOUT,
      (r) => r.text(),
    ));
  } catch (e) {
    // Not reachable: computer off, other Wi-Fi, wrong address. No point retrying many times.
    throw new CloudflareError(
      `Bilgisayara ulaşılamadı (${(e as Error).message}). Bilgisayar açık mı, Unsloth çalışıyor mu, telefon aynı Wi-Fi'da mı?`,
      'auth',
    );
  }
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (res.ok) return body;
  const message = String(body?.error?.message ?? body?.detail ?? body?.message ?? text.slice(0, 200) ?? '') || `HTTP ${res.status}`;
  if (res.status === 401 || res.status === 403) throw new CloudflareError(`Bilgisayardaki Unsloth anahtarı kabul etmedi: ${message}`, 'auth');
  if (res.status === 404 || res.status === 405) throw new CloudflareError(`Bu adres yok: ${path} (${message})`, 'other');
  if (res.status === 429 || res.status === 503) throw new CloudflareError(`Bilgisayar meşgul: ${message}`, 'busy');
  if (/no (image )?model|not loaded|load a model/i.test(message)) {
    throw new CloudflareError(
      `Unsloth'ta resim modeli yüklü değil. Görseller sayfasında FLUX.2 klein modelini yükleyin ya da API ayarlarında “Görüntü modelini isteğe göre değiştir”i açın. (${message})`,
      'auth',
    );
  }
  if (res.status >= 500) throw new CloudflareError(`Bilgisayardaki Unsloth hata verdi: ${message}`, 'other');
  throw new CloudflareError(`Unsloth: ${message}`, 'other');
}

function imageOf(r: any): string {
  const image = r?.data?.[0]?.b64_json;
  if (typeof image !== 'string' || image.length < 100) throw new CloudflareError('Bilgisayar resim döndürmedi.', 'other');
  return image;
}

/** Draws one picture on the computer; returns base64 (PNG or JPEG). */
export async function drawLocal(
  baseUrl: string,
  key: string,
  prompt: string,
  refs: string[],
  size: { width: number; height: number },
  seed?: number,
): Promise<string> {
  const base = normalizeBase(baseUrl);
  const sz = `${size.width}x${size.height}`;
  if (refs.length && !noEdits.has(base)) {
    // OpenAI's edits form: the reference pictures go as image[] parts.
    const fields: [string, string][] = [
      ['model', LOCAL_MODEL],
      ['prompt', prompt],
      ['size', sz],
      ['response_format', 'b64_json'],
      ['n', '1'],
    ];
    if (seed !== undefined) fields.push(['seed', String(seed)]);
    const files = await Promise.all(
      refs.slice(0, 4).map(async (uri, k) => ({ name: 'image[]', filename: `ref${k}.jpg`, data: await new File(uri).bytes() })),
    );
    const { body, contentType } = multipartBody(fields, files);
    try {
      return imageOf(
        await call(base, key, '/v1/images/edits', { method: 'POST', body: body as unknown as BodyInit, headers: { 'Content-Type': contentType } }),
      );
    } catch (e) {
      if (!(e instanceof CloudflareError) || !/^Bu adres yok/.test(e.message)) throw e;
      noEdits.add(base);
    }
  }
  const json: Record<string, unknown> = { model: LOCAL_MODEL, prompt, size: sz, response_format: 'b64_json', n: 1 };
  if (seed !== undefined) json.seed = seed;
  return imageOf(
    await call(base, key, '/v1/images/generations', { method: 'POST', body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } }),
  );
}

/** Quick check from the settings screen: is the server there and does it accept the key? */
export async function testLocal(baseUrl: string, key: string): Promise<string> {
  const base = normalizeBase(baseUrl);
  const r = await call(base, key, '/v1/models', { method: 'GET' });
  const n = Array.isArray(r?.data) ? r.data.length : 0;
  return n ? `Bağlandı. Unsloth'ta ${n} model görünüyor.` : 'Bağlandı.';
}
