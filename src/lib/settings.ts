import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

export type ReaderTheme = 'dark' | 'sepia' | 'light';

export interface ReaderSettings {
  fontSize: number;
  lineHeight: number;
  theme: ReaderTheme;
  /** Show the Turkish translation in the reader when there is one. */
  showTranslation: boolean;
  /** Translate chapters right after downloading them. */
  autoTranslate: boolean;
  /** Gemini model name, e.g. "models/gemini-…-flash". */
  geminiModel: string;
  /** Whether a Gemini key is saved (the key itself lives in secure storage). */
  hasGeminiKey: boolean;
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
  showTranslation: true,
  autoTranslate: false,
  geminiModel: '',
  hasGeminiKey: false,
};

const KEY_NAME = 'gemini-api-key';

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
