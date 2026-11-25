/**
 * Read-aloud engine: turns a chapter into clips (title + paragraphs), has the
 * Edge voice service speak them a few clips ahead, plays them one after the
 * other and publishes which word is being spoken so the reader can highlight
 * it. Lives outside React so playback continues across screens, into the next
 * chapter and with the screen off (lock-screen media controls keep the app
 * alive on Android).
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

import { getBook, saveProgress } from '../library';
import { getSettings, setSettings } from '../settings';
import { loadChapter, loadTranslation } from '../storage';
import type { ChapterContent } from '../types';
import { EdgeTtsError, VOICES_URL, locateWords, splitForSpeech, synthesize, type EdgeDeps, type WsFactory } from './edge';
import { trimMp3 } from './mp3';

export type NarrationStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface NarrationState {
  status: NarrationStatus;
  bookId: string | null;
  chapter: number;
  lang: 'tr' | 'en';
  /** Paragraph being read; -1 is the chapter title. */
  para: number;
  /** Highlighted characters inside that paragraph (-1 when none). */
  start: number;
  end: number;
  /** Message shown in the player bar (errors or "next chapter missing"). */
  message?: string;
}

interface Clip {
  para: number;
  offset: number;
  text: string;
}
interface Prepared {
  file: File;
  words: { start: number; end: number; t0: number; t1: number }[];
}

let state: NarrationState = { status: 'idle', bookId: null, chapter: 0, lang: 'en', para: -1, start: -1, end: -1 };
const listeners = new Set<() => void>();
function set(change: Partial<NarrationState>) {
  state = { ...state, ...change };
  for (const l of listeners) l();
}

export function useNarration(): NarrationState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
export const getNarration = () => state;

// ---- voice service -------------------------------------------------------

let clockSkew = 0;
const openSocket: WsFactory = (url, headers) =>
  new (WebSocket as unknown as new (u: string, p: undefined, o: { headers: Record<string, string> }) => ReturnType<WsFactory>)(
    url,
    undefined,
    { headers },
  );
const deps = (): EdgeDeps => ({
  sha256: (s) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, s),
  uuid: () => Crypto.randomUUID(),
  openSocket,
  clockSkew,
});

/** Ask the service for its clock; a wrong phone clock makes it refuse the token. */
async function syncClock(): Promise<boolean> {
  try {
    const res = await fetch(VOICES_URL, { method: 'GET' });
    const date = res.headers.get('date');
    if (!date) return false;
    const server = Date.parse(date) / 1000;
    if (!Number.isFinite(server)) return false;
    const skew = server - Date.now() / 1000;
    const changed = Math.abs(skew - clockSkew) > 5;
    clockSkew = skew;
    return changed;
  } catch {
    return false;
  }
}

async function speak(text: string, voice: string) {
  try {
    return await synthesize(text, { voice }, deps());
  } catch (e) {
    // One retry, after correcting the clock if it was off.
    await syncClock();
    try {
      return await synthesize(text, { voice }, deps());
    } catch (e2) {
      throw e2 instanceof EdgeTtsError ? e2 : (e as Error);
    }
  }
}

// ---- player ----------------------------------------------------------------

let player: AudioPlayer | null = null;
let gen = 0;
let clips: Clip[] = [];
let content: ChapterContent | null = null;
let cache = new Map<number, Promise<Prepared>>();
let current: { idx: number; prep: Prepared; gen: number } | null = null;
let wantPaused = false;
/** Clips whose audio is already on disk (no "loading" flash between them). */
const ready = new Set<Promise<Prepared>>();
let replacedAt = 0;

function audioDir(): Directory {
  const dir = new Directory(Paths.cache, 'tts');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function getPlayer(): AudioPlayer {
  if (player) return player;
  setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(
    () => undefined,
  );
  player = createAudioPlayer(null, { updateInterval: 100 });
  player.addListener('playbackStatusUpdate', onStatus);
  return player;
}

function voiceFor(lang: 'tr' | 'en') {
  const s = getSettings();
  return lang === 'tr' ? s.ttsVoiceTr : s.ttsVoiceEn;
}

function buildClips(c: ChapterContent): Clip[] {
  const out: Clip[] = [];
  if (c.title.trim()) out.push({ para: -1, offset: 0, text: c.title });
  c.paragraphs.forEach((p, k) => {
    if (!/[\p{L}\p{N}]/u.test(p)) return; // scene breaks like "***"
    for (const [offset, text] of splitForSpeech(p)) out.push({ para: k, offset, text });
  });
  return out;
}

function prepare(idx: number): Promise<Prepared> {
  let p = cache.get(idx);
  if (p) return p;
  const clip = clips[idx];
  const g = gen;
  const voice = voiceFor(state.lang);
  p = (async () => {
    const res = await speak(clip.text, voice);
    const last = res.words.length ? res.words[res.words.length - 1].end : 0;
    const audio = last > 0 ? trimMp3(res.audio, last + 0.35) : res.audio;
    const file = new File(audioDir(), `${g}-${state.chapter}-${idx}.mp3`);
    await file.write(audio);
    const words = locateWords(clip.text, res.words).map((w) => ({
      ...w,
      start: w.start + clip.offset,
      end: w.end + clip.offset,
    }));
    return { file, words };
  })();
  const prom = p;
  prom.then(() => ready.add(prom)).catch(() => cache.delete(idx));
  cache.set(idx, prom);
  return p;
}

function dropFile(f: File) {
  try {
    if (f.exists) f.delete();
  } catch {
    // ignore
  }
}

function clearAudio() {
  for (const p of cache.values()) p.then((x) => dropFile(x.file)).catch(() => undefined);
  cache = new Map();
  ready.clear();
}

async function playClip(g: number, idx: number): Promise<void> {
  if (g !== gen) return;
  if (idx >= clips.length) return nextChapter(g);
  const clip = clips[idx];
  if (!current || current.idx !== idx) set({ para: clip.para, start: -1, end: -1 });
  let prep: Prepared;
  try {
    const pending = prepare(idx);
    if (!ready.has(pending)) set({ status: wantPaused ? 'paused' : 'loading' });
    prep = await pending;
  } catch (e) {
    if (g === gen) {
      player?.pause();
      set({ status: 'error', message: (e as Error).message || 'Ses alınamadı.' });
    }
    return;
  }
  if (g !== gen) return;
  const p = getPlayer();
  const prev = current;
  current = { idx, prep, gen: g };
  replacedAt = Date.now();
  p.replace({ uri: prep.file.uri });
  p.setPlaybackRate(getSettings().ttsRate);
  if (!wantPaused) p.play();
  set({ status: wantPaused ? 'paused' : 'playing', message: undefined });
  for (let k = idx + 1; k <= idx + 2 && k < clips.length; k++) prepare(k).catch(() => undefined);
  if (prev && prev.idx !== idx) {
    cache.delete(prev.idx);
    dropFile(prev.prep.file);
  }
}

function onStatus(s: AudioStatus) {
  const cur = current;
  if (!cur || cur.gen !== gen) return;
  if (s.didJustFinish) {
    // A late "finished" from the clip we just replaced must not skip the new one.
    if (Date.now() - replacedAt < 300) return;
    current = null;
    cache.delete(cur.idx);
    dropFile(cur.prep.file);
    playClip(gen, cur.idx + 1).catch(() => undefined);
    return;
  }
  // Lock-screen / headset buttons change the player behind our back.
  const settled = Date.now() - replacedAt > 800;
  const midClip = s.currentTime > 0 && (!s.duration || s.currentTime < s.duration - 0.3);
  if (settled && midClip && s.isLoaded && !s.playing && !s.isBuffering && state.status === 'playing') {
    wantPaused = true;
    set({ status: 'paused' });
  } else if (s.playing && state.status === 'paused') {
    wantPaused = false;
    set({ status: 'playing' });
  }
  const t = s.currentTime + 0.05;
  let w = -1;
  for (let k = 0; k < cur.prep.words.length && cur.prep.words[k].t0 <= t; k++) w = k;
  const word = cur.prep.words[w];
  const start = word ? word.start : -1;
  const end = word ? word.end : -1;
  if (start !== state.start || end !== state.end) set({ start, end });
}

async function loadFor(bookId: string, k: number): Promise<{ c: ChapterContent; lang: 'tr' | 'en' } | null> {
  const book = getBook(bookId);
  if (!book) return null;
  const original: 'tr' | 'en' = book.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en';
  if (getSettings().showTranslation && book.translated?.includes(k)) {
    const t = await loadTranslation(bookId, k).catch(() => null);
    if (t) return { c: t, lang: 'tr' };
  }
  const c = await loadChapter(bookId, k).catch(() => null);
  return c ? { c, lang: original } : null;
}

function lockScreen(active: boolean) {
  const p = getPlayer();
  try {
    if (!active) return p.clearLockScreenControls();
    const book = state.bookId ? getBook(state.bookId) : undefined;
    p.setActiveForLockScreen(
      true,
      { title: content?.title || `Bölüm ${state.chapter + 1}`, artist: book?.title ?? 'Ebook' },
      { showSeekForward: false, showSeekBackward: false },
    );
  } catch {
    // lock-screen controls are optional
  }
}

async function nextChapter(g: number) {
  const id = state.bookId;
  if (!id) return;
  const book = getBook(id);
  const k = state.chapter + 1;
  if (!book || k >= book.chapters.length) {
    stopNarration('Kitabın sonuna gelindi.');
    return;
  }
  if (!book.downloaded.includes(k)) {
    stopNarration(`${k + 1}. bölüm indirilmemiş; okuma durdu.`);
    return;
  }
  set({ status: 'loading' });
  const next = await loadFor(id, k);
  if (g !== gen) return;
  if (!next) {
    stopNarration(`${k + 1}. bölüm açılamadı.`);
    return;
  }
  saveProgress(id, k, 0).catch(() => undefined);
  begin(next.c, next.lang, id, k, 0);
}

function begin(c: ChapterContent, lang: 'tr' | 'en', bookId: string, chapter: number, fromPara: number) {
  gen++;
  clearAudio();
  current = null;
  content = c;
  clips = buildClips(c);
  set({ bookId, chapter, lang, para: fromPara, start: -1, end: -1, message: undefined });
  lockScreen(true);
  let idx = clips.findIndex((x) => x.para >= fromPara);
  if (idx < 0) idx = clips.length;
  playClip(gen, idx).catch(() => undefined);
}

// ---- public API ------------------------------------------------------------

/** Start reading `content` (what the reader shows) from a paragraph (-1 = title). */
export function startNarration(bookId: string, chapter: number, c: ChapterContent, lang: 'tr' | 'en', fromPara = -1) {
  wantPaused = false;
  getPlayer();
  begin(c, lang, bookId, chapter, fromPara);
}

/** Jump to a paragraph of the chapter being read. */
export function narrateFrom(para: number) {
  if (!content || !state.bookId) return;
  wantPaused = false;
  const idx = clips.findIndex((x) => x.para >= para);
  gen++;
  current = null;
  player?.pause();
  // Clips already fetched stay valid; renumber them under the new generation.
  const kept = cache;
  cache = new Map();
  for (const [k, p] of kept) {
    if (k >= idx && k <= idx + 2) cache.set(k, p);
    else p.then((x) => dropFile(x.file)).catch(() => undefined);
  }
  playClip(gen, idx < 0 ? clips.length : idx).catch(() => undefined);
}

/** Restart at the current paragraph (after a voice change). */
export function restartNarration() {
  if (!content || !state.bookId || state.status === 'idle') return;
  const para = state.para;
  gen++;
  clearAudio();
  current = null;
  player?.pause();
  wantPaused = false;
  const idx = clips.findIndex((x) => x.para >= para);
  playClip(gen, idx < 0 ? clips.length : idx).catch(() => undefined);
}

export function skipParagraph(delta: 1 | -1) {
  if (!content) return;
  const paras = [...new Set(clips.map((c) => c.para))];
  const at = paras.indexOf(state.para);
  const target = paras[Math.max(0, Math.min(paras.length - 1, (at < 0 ? 0 : at) + delta))];
  if (target !== undefined) narrateFrom(target);
}

export function pauseNarration() {
  wantPaused = true;
  player?.pause();
  if (state.status === 'playing' || state.status === 'loading') set({ status: 'paused' });
}

export function resumeNarration() {
  if (state.status === 'error') {
    restartNarration();
    return;
  }
  wantPaused = false;
  if (current && current.gen === gen) {
    player?.play();
    set({ status: 'playing' });
  } else set({ status: 'loading' });
}

export function setNarrationRate(rate: number) {
  setSettings({ ttsRate: rate });
  player?.setPlaybackRate(rate);
}

export function stopNarration(message?: string) {
  gen++;
  current = null;
  wantPaused = false;
  player?.pause();
  if (player) lockScreen(false);
  clearAudio();
  content = null;
  clips = [];
  set({ status: 'idle', para: -1, start: -1, end: -1, message });
}
