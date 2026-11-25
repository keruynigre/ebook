/**
 * Microsoft Edge "Read aloud" speech service (the same one the edge-tts Python
 * package uses). Free, no key; returns MP3 audio plus the time of every word,
 * which drives the follow-along highlight.
 *
 * Kept free of React Native imports so the protocol helpers can be tested in
 * Node; the WebSocket constructor and SHA-256 function are passed in.
 */

export const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split('.')[0];
const WSS_URL =
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=' + TRUSTED_CLIENT_TOKEN;
export const VOICES_URL =
  'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=' +
  TRUSTED_CLIENT_TOKEN;
const WIN_EPOCH = 11644473600;

export const EDGE_HEADERS: Record<string, string> = {
  'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR}.0.0.0`,
  'Accept-Language': 'en-US,en;q=0.9',
  Pragma: 'no-cache',
  'Cache-Control': 'no-cache',
  Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
};

export interface WordTiming {
  text: string;
  /** Seconds from the start of the clip. */
  start: number;
  end: number;
}

export interface SpeechResult {
  audio: Uint8Array;
  words: WordTiming[];
}

export interface SpeakOptions {
  /** Short voice id, e.g. "tr-TR-AhmetNeural". */
  voice: string;
  rate?: string;
  pitch?: string;
  volume?: string;
}

/** The string the Sec-MS-GEC token hashes: Windows file time rounded down to 5 minutes, plus the client token. */
export function secMsGecInput(unixSeconds: number): string {
  let ticks = Math.floor(unixSeconds) + WIN_EPOCH;
  ticks -= ticks % 300;
  // 100-nanosecond intervals; too large for a double, so use BigInt.
  return (BigInt(ticks) * 10000000n).toString() + TRUSTED_CLIENT_TOKEN;
}

export function fullVoiceName(voice: string): string {
  const m = /^([a-z]{2,3}-[A-Z]{2,4}(?:-[A-Za-z]+)?)-(.+)$/.exec(voice);
  if (!m) return voice;
  return `Microsoft Server Speech Text to Speech Voice (${m[1]}, ${m[2]})`;
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Characters the service chokes on (control characters) become spaces. */
export function cleanForSpeech(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ');
}

export function makeSsml(text: string, o: SpeakOptions): string {
  return (
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    `<voice name='${fullVoiceName(o.voice)}'>` +
    `<prosody pitch='${o.pitch ?? '+0Hz'}' rate='${o.rate ?? '+0%'}' volume='${o.volume ?? '+0%'}'>` +
    escapeXml(cleanForSpeech(text)) +
    '</prosody></voice></speak>'
  );
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => String(n).padStart(2, '0');

export function edgeDate(d: Date): string {
  return (
    `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${p2(d.getUTCDate())} ${d.getUTCFullYear()} ` +
    `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
  );
}

export function configMessage(date: Date): string {
  return (
    `X-Timestamp:${edgeDate(date)}\r\n` +
    'Content-Type:application/json; charset=utf-8\r\n' +
    'Path:speech.config\r\n\r\n' +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},' +
    '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'
  );
}

export function ssmlMessage(requestId: string, date: Date, ssml: string): string {
  return (
    `X-RequestId:${requestId}\r\n` +
    'Content-Type:application/ssml+xml\r\n' +
    // The trailing "Z" mirrors a quirk of Edge itself.
    `X-Timestamp:${edgeDate(date)}Z\r\n` +
    'Path:ssml\r\n\r\n' +
    ssml
  );
}

function parseHeaders(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split('\r\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return out;
}

/** Split a text frame into its headers and body. */
export function parseTextFrame(data: string): { path: string; body: string } {
  const i = data.indexOf('\r\n\r\n');
  const head = parseHeaders(i >= 0 ? data.slice(0, i) : data);
  return { path: head.Path ?? '', body: i >= 0 ? data.slice(i + 4) : '' };
}

/** Split a binary frame: 2-byte big-endian header length, headers, then audio. */
export function parseBinaryFrame(buf: Uint8Array): { path: string; audio: Uint8Array } {
  if (buf.length < 2) return { path: '', audio: new Uint8Array(0) };
  const len = (buf[0] << 8) | buf[1];
  let head = '';
  for (let k = 2; k < 2 + len && k < buf.length; k++) head += String.fromCharCode(buf[k]);
  return { path: parseHeaders(head).Path ?? '', audio: buf.subarray(2 + len) };
}

/** Word timings from an audio.metadata body. */
export function parseMetadata(body: string): WordTiming[] {
  const out: WordTiming[] = [];
  try {
    const json = JSON.parse(body) as {
      Metadata?: { Type: string; Data: { Offset: number; Duration: number; text?: { Text?: string } } }[];
    };
    for (const m of json.Metadata ?? []) {
      if (m.Type !== 'WordBoundary') continue;
      const start = m.Data.Offset / 1e7;
      out.push({ text: m.Data.text?.Text ?? '', start, end: start + m.Data.Duration / 1e7 });
    }
  } catch {
    // ignore malformed metadata
  }
  return out;
}

export class EdgeTtsError extends Error {}

type WsLike = {
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onclose: ((e: { code?: number; reason?: string }) => void) | null;
  send(data: string): void;
  close(): void;
};
export type WsFactory = (url: string, headers: Record<string, string>) => WsLike;

export interface EdgeDeps {
  /** Uppercase or lowercase hex SHA-256 of a string. */
  sha256: (s: string) => Promise<string>;
  uuid: () => string;
  openSocket: WsFactory;
  /** Seconds to add to the device clock (the service rejects a skewed clock). */
  clockSkew?: number;
  timeoutMs?: number;
}

const randomHex = (n: number) => {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s.toUpperCase();
};

/** Synthesize one piece of text (keep it under ~3000 characters). */
export async function synthesize(text: string, opts: SpeakOptions, deps: EdgeDeps): Promise<SpeechResult> {
  const now = Date.now() / 1000 + (deps.clockSkew ?? 0);
  const gec = (await deps.sha256(secMsGecInput(now))).toUpperCase();
  const connId = deps.uuid().replace(/-/g, '');
  const url = `${WSS_URL}&ConnectionId=${connId}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}`;
  const headers = { ...EDGE_HEADERS, Cookie: `muid=${randomHex(32)};` };

  return new Promise<SpeechResult>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const words: WordTiming[] = [];
    let done = false;
    const ws = deps.openSocket(url, headers);
    ws.binaryType = 'arraybuffer';

    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // already closed
      }
      if (err) return reject(err);
      const size = chunks.reduce((n, c) => n + c.length, 0);
      if (!size) return reject(new EdgeTtsError('Ses hizmeti boş yanıt verdi.'));
      const audio = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) {
        audio.set(c, at);
        at += c.length;
      }
      resolve({ audio, words });
    };
    const timer = setTimeout(() => finish(new EdgeTtsError('Ses hizmeti yanıt vermedi (zaman aşımı).')), deps.timeoutMs ?? 30000);

    ws.onopen = () => {
      const date = new Date(Date.now() + (deps.clockSkew ?? 0) * 1000);
      ws.send(configMessage(date));
      ws.send(ssmlMessage(deps.uuid().replace(/-/g, ''), date, makeSsml(text, opts)));
    };
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        const { path, body } = parseTextFrame(e.data);
        if (path === 'audio.metadata') words.push(...parseMetadata(body));
        else if (path === 'turn.end') finish();
        return;
      }
      if (e.data instanceof ArrayBuffer) {
        const { path, audio } = parseBinaryFrame(new Uint8Array(e.data));
        if (path === 'audio' && audio.length) chunks.push(audio.slice());
      }
    };
    ws.onerror = (e) => {
      const msg = (e as { message?: string })?.message;
      finish(new EdgeTtsError('Ses hizmetine bağlanılamadı' + (msg ? `: ${msg}` : '.')));
    };
    ws.onclose = (e) => {
      if (!done) finish(new EdgeTtsError(`Ses hizmeti bağlantıyı kapattı (${e?.code ?? '?'}${e?.reason ? ' ' + e.reason : ''}).`));
    };
  });
}

/** Split long text into pieces of at most `max` characters at sentence ends (or spaces). Returns [offset, text] pairs. */
export function splitForSpeech(text: string, max = 2500): [number, string][] {
  const out: [number, string][] = [];
  let at = 0;
  while (text.length - at > max) {
    const window = text.slice(at, at + max);
    let cut = -1;
    const re = /[.!?…]["”’»)]*\s+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(window))) cut = m.index + m[0].length;
    if (cut < max * 0.3) cut = window.lastIndexOf(' ') + 1;
    if (cut <= 0) cut = max;
    out.push([at, text.slice(at, at + cut)]);
    at += cut;
  }
  if (at < text.length) out.push([at, text.slice(at)]);
  return out.filter(([, t]) => t.trim());
}

/**
 * Character ranges of the spoken words inside `text`, in order. Words that
 * cannot be found (the service sometimes normalizes symbols) are skipped.
 */
export function locateWords(text: string, words: WordTiming[]): { start: number; end: number; t0: number; t1: number }[] {
  const out: { start: number; end: number; t0: number; t1: number }[] = [];
  let cursor = 0;
  for (const w of words) {
    const needle = w.text.trim();
    if (!needle) continue;
    const i = text.indexOf(needle, cursor);
    if (i < 0 || i - cursor > 80) continue;
    out.push({ start: i, end: i + needle.length, t0: w.start, t1: w.end });
    cursor = i + needle.length;
  }
  return out;
}
