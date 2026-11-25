import { generic } from './generic';
import { novelFull } from './novelfull';
import type { NovelSource } from './types';

export type { NovelSource } from './types';

/** Dedicated sources first; the generic one is the last resort. */
const SOURCES: NovelSource[] = [novelFull, generic];

export function sourceForUrl(url: string): NovelSource {
  const u = new URL(url);
  return SOURCES.find((s) => s.matches(u))!;
}

export function sourceById(id: string): NovelSource {
  return SOURCES.find((s) => s.id === id) ?? generic;
}
