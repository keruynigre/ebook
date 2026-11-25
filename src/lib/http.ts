import type { Http } from './types';

export const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Recognises the Cloudflare (and similar) "checking your browser" pages. */
export function isChallengePage(status: number, body: string): boolean {
  if (status !== 403 && status !== 503 && status !== 429 && status !== 200) return false;
  const head = body.slice(0, 6000);
  const titled = /<title>\s*(Just a moment|Attention Required|Bir dakika|Checking your browser)/i.test(head);
  // Normal pages can mention Cloudflare scripts too, so a 200 needs the challenge title.
  if (status === 200) return titled;
  return titled || /challenges\.cloudflare\.com|cf-challenge|__cf_chl_|cf_chl_opt/i.test(head);
}

/**
 * A browser that can fetch pages with a real WebView, so sites protected by a
 * JavaScript check still work. Registered by <BrowserHost/>.
 */
export interface BrowserBridge {
  fetchText(url: string): Promise<string>;
}

let bridge: BrowserBridge | null = null;
export function registerBrowserBridge(b: BrowserBridge | null) {
  bridge = b;
}

/** Hosts that answered with a challenge; they are fetched through the WebView from then on. */
const browserHosts = new Set<string>();

async function directFetch(url: string, accept: string): Promise<Response> {
  return fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: accept,
      'Accept-Language': 'en-US,en;q=0.9,tr;q=0.8',
    },
  });
}

async function viaBrowser(url: string): Promise<string> {
  if (!bridge) throw new HttpError('Tarayıcı hazır değil, lütfen tekrar deneyin.');
  return bridge.fetchText(url);
}

export const http: Http = {
  async getText(url) {
    const host = new URL(url).host;
    if (browserHosts.has(host)) return viaBrowser(url);
    let res: Response;
    try {
      res = await directFetch(url, 'text/html,application/xhtml+xml,*/*;q=0.8');
    } catch (e) {
      throw new HttpError(`Bağlantı kurulamadı: ${(e as Error).message}`);
    }
    const body = await res.text();
    if (isChallengePage(res.status, body)) {
      browserHosts.add(host);
      return viaBrowser(url);
    }
    if (!res.ok) throw new HttpError(`Sayfa açılamadı (HTTP ${res.status}).`, res.status);
    return body;
  },

  async getBytes(url) {
    const res = await directFetch(url, 'image/avif,image/webp,image/*,*/*;q=0.8');
    if (!res.ok) throw new HttpError(`Dosya indirilemedi (HTTP ${res.status}).`, res.status);
    return new Uint8Array(await res.arrayBuffer());
  },
};
