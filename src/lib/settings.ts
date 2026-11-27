import type { ComicQuality } from './comicCore';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

import type { ReaderFont } from './fonts';

export type ReaderTheme = 'dark' | 'sepia' | 'light';

export interface ReaderSettings {
  fontSize: number;
  lineHeight: number;
  theme: ReaderTheme;
  fontFamily: ReaderFont;
  /** Show the Turkish translation in the reader when there is one. */
  showTranslation: boolean;
  /** Translate chapters right after downloading them. */
  autoTranslate: boolean;
  /** Translate an untranslated chapter as soon as it is opened (and get the next one ready). */
  translateOnOpen: boolean;
  /** Gemini model name, e.g. "models/gemini-…-flash". */
  geminiModel: string;
  /** Models this key can use, best first; tried in turn when one is busy. */
  geminiModels: string[];
  /** How many chapters are translated at the same time (1 for the free tier). */
  translateConcurrency: number;
  /** Custom translation instructions; empty means the built-in default. */
  translationPrompt: string;
  /** Whether a Gemini key is saved (the key itself lives in secure storage). */
  hasGeminiKey: boolean;
  /** Read-aloud voices (Edge voice ids) for Turkish and English text. */
  ttsVoiceTr: string;
  ttsVoiceEn: string;
  /** Read-aloud speed, 1 = normal. */
  ttsRate: number;
  /** Auto-scroll speed level (1–20); pixels per second = level × AUTO_PX. */
  autoScrollSpeed: number;
  /** Look for a newer APK on GitHub when the app starts. */
  checkUpdates: boolean;
  /** A newer version the person chose to skip (no banner for it). */
  skippedUpdate: string;
  /** Cloudflare account for drawing comic panels (Workers AI); the token lives in secure storage. */
  cfAccountId: string;
  hasCfToken: boolean;
  /** Draw with Cloudflare or on the person's own computer (Unsloth on the same Wi-Fi). */
  imageSource: 'cloudflare' | 'local';
  /** Address of the computer, e.g. http://192.168.1.20:8888. */
  localImageUrl: string;
  /** Unsloth API key (empty when keyless access is on). Only works on the home network. */
  localImageKey: string;
  /** Comic panels in colour instead of black and white. */
  comicColor: boolean;
  /** 'webtoon': modern colour manhua, tall pictures and dynamic camera angles. */
  comicLook: 'classic' | 'webtoon';
  /** Show pictures of the key moments inside the text (drawn with Cloudflare). */
  illustrate: boolean;
  /** Panel size and number of references: smaller costs fewer Cloudflare neurons. */
  comicQuality: ComicQuality;
  /** Pictures per chapter; 0 = as the quality preset suggests. */
  comicCount: number;
  /** Whether an art style picture was chosen for the comic (saved as comic-style.jpg). */
  comicStyleRef: boolean;
  /** Changes whenever a new style picture is chosen, so character cards are drawn again in the new style. */
  comicStyleVersion: number;
}

export const READER_THEMES: Record<ReaderTheme, { bg: string; text: string; muted: string; label: string }> = {
  dark: { bg: '#14161c', text: '#e4e6eb', muted: '#8a909e', label: 'Koyu' },
  sepia: { bg: '#f3e9d2', text: '#3b2f1e', muted: '#7d6a4f', label: 'Sepya' },
  light: { bg: '#ffffff', text: '#1a1a1a', muted: '#6b6b6b', label: 'Açık' },
};

const DEFAULTS: ReaderSettings = {
  fontSize: 18,
  lineHeight: 1.6,
  theme: 'dark',
  fontFamily: 'system',
  showTranslation: true,
  autoTranslate: false,
  translateOnOpen: false,
  geminiModel: '',
  geminiModels: [],
  translateConcurrency: 1,
  translationPrompt: '',
  hasGeminiKey: false,
  ttsVoiceTr: 'tr-TR-AhmetNeural',
  ttsVoiceEn: 'en-US-ChristopherNeural',
  ttsRate: 1,
  autoScrollSpeed: 4,
  checkUpdates: true,
  skippedUpdate: '',
  cfAccountId: '',
  hasCfToken: false,
  imageSource: 'cloudflare',
  localImageUrl: '',
  localImageKey: '',
  comicColor: false,
  comicLook: 'classic',
  illustrate: false,
  comicQuality: 'balanced',
  comicCount: 0,
  comicStyleRef: false,
  comicStyleVersion: 0,
};

const KEY_NAME = 'gemini-api-key';
const CF_KEY_NAME = 'cloudflare-api-token';

let settings: ReaderSettings = DEFAULTS;
const listeners = new Set<() => void>();
const file = () => new File(Paths.document, 'settings.json');

export async function loadSettings(): Promise<void> {
  try {
    const f = file();
    if (f.exists) settings = { ...DEFAULTS, ...JSON.parse(await f.text()) };
  } catch {
    settings = DEFAULTS;
  }
  try {
    settings = { ...settings, hasGeminiKey: !!(await SecureStore.getItemAsync(KEY_NAME)) };
  } catch {
    settings = { ...settings, hasGeminiKey: false };
  }
  try {
    settings = { ...settings, hasCfToken: !!(await SecureStore.getItemAsync(CF_KEY_NAME)) };
  } catch {
    settings = { ...settings, hasCfToken: false };
  }
  for (const l of listeners) l();
}

export function setSettings(change: Partial<ReaderSettings>): void {
  settings = { ...settings, ...change };
  for (const l of listeners) l();
  file()
    .write(JSON.stringify(settings))
    .catch(() => undefined);
}

export function useSettings(): ReaderSettings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => settings,
  );
}

export function getSettings(): ReaderSettings {
  return settings;
}

export async function getGeminiKey(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_NAME);
}

export async function setGeminiKey(key: string | null): Promise<void> {
  if (key) await SecureStore.setItemAsync(KEY_NAME, key);
  else await SecureStore.deleteItemAsync(KEY_NAME);
  setSettings({ hasGeminiKey: !!key });
}

export async function getCfToken(): Promise<string | null> {
  return SecureStore.getItemAsync(CF_KEY_NAME);
}

export async function setCfToken(token: string | null): Promise<void> {
  if (token) await SecureStore.setItemAsync(CF_KEY_NAME, token);
  else await SecureStore.deleteItemAsync(CF_KEY_NAME);
  setSettings({ hasCfToken: !!token });
}
