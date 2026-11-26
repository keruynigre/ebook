/**
 * Checks GitHub Releases for a newer APK. Installing stays in the person's
 * hands: the APK opens in the browser to download, then Android asks to install.
 */
import Constants from 'expo-constants';
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
