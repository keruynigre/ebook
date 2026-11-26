/** Cloudflare Workers AI: draws comic panels with FLUX. */
import { fetchWithTimeout } from './text';

const API = 'https://api.cloudflare.com/client/v4';
export const FLUX_MODEL = '@cf/black-forest-labs/flux-1-schnell';
/** FLUX.2 [klein] 4B: takes up to 4 reference pictures (each under 512×512), multipart form input. */
export const FLUX2_MODEL = '@cf/black-forest-labs/flux-2-klein-4b';

export class CloudflareError extends Error {
  constructor(
    message: string,
    /** auth: bad token or account; daily: free allowance used up; rate: too fast; blocked: prompt refused. */
    readonly kind: 'auth' | 'daily' | 'rate' | 'busy' | 'blocked' | 'other',
  ) {
    super(message);
  }
}

async function cf(token: string, path: string, init?: RequestInit): Promise<any> {
  let res: Response;
  let text: string;
  try {
    ({ res, body: text } = await fetchWithTimeout(
      `${API}${path}`,
      {
        ...init,
        // FormData bodies set their own multipart Content-Type (with the boundary).
        headers: {
          Authorization: `Bearer ${token}`,
          ...(typeof init?.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
          ...(init?.headers ?? {}),
        },
      },
      120_000,
      (r) => r.text(),
    ));
  } catch (e) {
    throw new CloudflareError(`Cloudflare'a bağlanılamadı: ${(e as Error).message}`, 'busy');
  }
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (res.ok && body?.success !== false) return body;
  const errors: any[] = body?.errors ?? [];
  const message = errors.map((e) => e?.message).filter(Boolean).join('; ') || text.slice(0, 200) || `HTTP ${res.status}`;
  const codes = errors.map((e) => Number(e?.code));
  if (codes.includes(4006) || codes.includes(3036) || /daily free allocation|neurons/i.test(message)) {
    throw new CloudflareError('Cloudflare’ın bugünkü ücretsiz çizim hakkı doldu. Yarın kaldığı yerden devam eder.', 'daily');
  }
  if (res.status === 401 || res.status === 403 || codes.includes(10000) || /authentication|unauthori[sz]ed/i.test(message)) {
    throw new CloudflareError(`Cloudflare anahtarı ya da hesap kimliği kabul edilmedi: ${message}`, 'auth');
  }
  if (res.status === 429) throw new CloudflareError('Cloudflare çok hızlı istek dedi, biraz bekleniyor…', 'rate');
  if (res.status >= 500) throw new CloudflareError(`Cloudflare geçici bir hata verdi: ${message}`, 'busy');
  if (/nsfw|safety|flagged|inappropriate/i.test(message)) throw new CloudflareError('Bu kare güvenlik filtresine takıldı.', 'blocked');
  throw new CloudflareError(`Cloudflare hatası: ${message}`, 'other');
}

/** Accounts the token can use (to fill in the account ID automatically). */
export async function listAccounts(token: string): Promise<{ id: string; name: string }[]> {
  const r = await cf(token, '/accounts?per_page=50');
  return (Array.isArray(r?.result) ? r.result : []).map((a: any) => ({ id: String(a.id), name: String(a.name ?? a.id) }));
}

/** Draw one picture; returns a base64 JPEG. */
export async function drawImage(token: string, accountId: string, prompt: string, seed?: number): Promise<string> {
  const body: Record<string, unknown> = { prompt, steps: 4 };
  if (seed !== undefined) body.seed = seed;
  const r = await cf(token, `/accounts/${encodeURIComponent(accountId)}/ai/run/${FLUX_MODEL}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const image = r?.result?.image ?? r?.image;
  if (typeof image !== 'string' || image.length < 100) throw new CloudflareError('Cloudflare resim döndürmedi.', 'other');
  return image;
}

/**
 * Draw with FLUX.2 klein, optionally from reference pictures (file URIs, JPEG, under 512×512).
 * Returns a base64 image.
 */
export async function drawWithRefs(
  token: string,
  accountId: string,
  prompt: string,
  refs: string[],
  size: { width: number; height: number },
  seed?: number,
): Promise<string> {
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('width', String(size.width));
  form.append('height', String(size.height));
  if (seed !== undefined) form.append('seed', String(seed));
  refs.slice(0, 4).forEach((uri, k) => {
    // React Native sends { uri, name, type } entries as file parts.
    form.append(`input_image_${k}`, { uri, name: `ref${k}.jpg`, type: 'image/jpeg' } as unknown as Blob);
  });
  const r = await cf(token, `/accounts/${encodeURIComponent(accountId)}/ai/run/${FLUX2_MODEL}`, { method: 'POST', body: form });
  const image = r?.result?.image ?? r?.image;
  if (typeof image !== 'string' || image.length < 100) throw new CloudflareError('Cloudflare resim döndürmedi.', 'other');
  return image;
}
