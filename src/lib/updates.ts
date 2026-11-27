/**
 * Checks GitHub Releases for a newer APK. Installing stays in the person's
 * hands: the APK opens in the browser to download, then Android asks to install.
 */
import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

import { getSettings } from './settings';
import { compareVersions, versionFromTag } from './updateCore';

const REPO = 'keruynigre/ebook';
export const RELEASES_PAGE = `https://github.com/${REPO}/releases`;

export interface UpdateInfo {
  version: string;
  tag: string;
  apkUrl: string;
  pageUrl: string;
  /** What changed: the first line of the commit message the build was made from. */
  notes: string;
  publishedAt: string;
}

export const appVersion = (): string => Constants.expoConfig?.version ?? '0';

let state: { checking: boolean; update: UpdateInfo | null; error: string; checkedAt: number } = {
  checking: false,
  update: null,
  error: '',
  checkedAt: 0,
};
const listeners = new Set<() => void>();
function set(s: Partial<typeof state>) {
  state = { ...state, ...s };
  for (const l of listeners) l();
}

export function useUpdate() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(res.status === 403 ? 'GitHub şu an çok sık sorgulandı, biraz sonra deneyin.' : `GitHub yanıtı: HTTP ${res.status}`);
  return res.json();
}

/** Ask GitHub for the latest release. Returns it when it is newer than this app. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (state.checking) return state.update;
  set({ checking: true, error: '' });
  try {
    const r = await getJson(`https://api.github.com/repos/${REPO}/releases/latest`);
    const tag = String(r?.tag_name ?? '');
    const version = versionFromTag(tag);
    const apk = (Array.isArray(r?.assets) ? r.assets : []).find((a: any) => /\.apk$/i.test(String(a?.name ?? '')));
    if (!version || !apk || compareVersions(version, appVersion()) <= 0) {
      set({ checking: false, update: null, checkedAt: Date.now() });
      return null;
    }
    let notes = '';
    const sha = String(r?.target_commitish ?? '');
    if (/^[0-9a-f]{7,40}$/i.test(sha)) {
      const c = await getJson(`https://api.github.com/repos/${REPO}/commits/${sha}`).catch(() => null);
      notes = String(c?.commit?.message ?? '').split('\n')[0];
    }
    const update: UpdateInfo = {
      version,
      tag,
      apkUrl: String(apk.browser_download_url),
      pageUrl: String(r?.html_url ?? RELEASES_PAGE),
      notes,
      publishedAt: String(r?.published_at ?? ''),
    };
    set({ checking: false, update, checkedAt: Date.now() });
    return update;
  } catch (e) {
    set({ checking: false, error: (e as Error).message, checkedAt: Date.now() });
    throw e;
  }
}

/** On app start: check quietly (setting "check for updates"), at most every few hours. */
export function checkOnStart() {
  if (getSettings().checkUpdates === false) return;
  if (Date.now() - state.checkedAt < 3 * 60 * 60 * 1000) return;
  checkForUpdate().catch(() => undefined);
}

// ---- in-app download and install: no browser in between ----

export type InstallState =
  | { phase: 'idle' }
  | { phase: 'downloading'; version: string; got: number; total: number }
  | { phase: 'ready'; version: string }
  | { phase: 'error'; version: string; message: string };

let install: InstallState = { phase: 'idle' };
const installListeners = new Set<() => void>();
function setInstall(s: InstallState) {
  install = s;
  for (const l of installListeners) l();
}

export function useInstall() {
  return useSyncExternalStore(
    (l) => {
      installListeners.add(l);
      return () => installListeners.delete(l);
    },
    () => install,
  );
}

const APK_MIME = 'application/vnd.android.package-archive';

/** Hand the downloaded APK to Android's installer ("Güncelle" screen). */
async function openInstaller(file: File) {
  await File.preview(file, { mimeType: APK_MIME });
}

/**
 * Downloads the new APK into the app's cache, then opens Android's installer.
 * The first time, Android asks to allow "Ebook" to install apps; after allowing,
 * pressing "Kur" again opens the installer.
 */
export async function downloadAndInstall(u: UpdateInfo): Promise<void> {
  if (install.phase === 'downloading') return;
  const dir = new Directory(Paths.cache, 'update');
  const file = new File(dir, `ebook-${u.version}.apk`);
  try {
    // Already downloaded in full earlier: just open the installer again.
    const doneMark = new File(dir, `ebook-${u.version}.done`);
    if (file.exists && doneMark.exists) {
      setInstall({ phase: 'ready', version: u.version });
      await openInstaller(file);
      return;
    }
    if (dir.exists) dir.delete(); // old versions and half-finished downloads
    dir.create({ intermediates: true });
    setInstall({ phase: 'downloading', version: u.version, got: 0, total: 0 });
    let lastTick = 0;
    await File.downloadFileAsync(u.apkUrl, file, {
      idempotent: true,
      onProgress: ({ bytesWritten, totalBytes }) => {
        const now = Date.now();
        if (now - lastTick < 250) return;
        lastTick = now;
        setInstall({ phase: 'downloading', version: u.version, got: bytesWritten, total: totalBytes });
      },
    });
    if (!file.exists || file.size < 1_000_000) throw new Error('İndirilen dosya eksik.');
    doneMark.create();
    setInstall({ phase: 'ready', version: u.version });
    await openInstaller(file);
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    setInstall({ phase: 'error', version: u.version, message: msg });
    throw e;
  }
}
