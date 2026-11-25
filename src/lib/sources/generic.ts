import { parse, type HTMLElement } from 'node-html-parser';

import { absoluteUrl, cleanParagraphs, htmlToParagraphs, textOf } from '../text';
import type { ChapterContent, ChapterRef, NovelInfo } from '../types';
import type { NovelSource } from './types';

/**
 * Best-effort reader for sites without a dedicated source.
 * Finds chapter links by their text/address and picks the largest text block on chapter pages.
 */

const CHAPTER_LINK = /(chapter|chap|bölüm|bolum|episode|ch-?\d)/i;
const CONTENT_SELECTORS = [
  '#chapter-content', '#chr-content', '.chapter-content', '.chapter-c', '.reading-content',
  '.text-left', '.entry-content', '#content', '.content', 'article',
];

export function parseGenericNovel(html: string, url: string): NovelInfo {
  const root = parse(html);
  const host = new URL(url).hostname;
  const title =
    root.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ||
    textOf(root.querySelector('h1')) ||
    textOf(root.querySelector('title')) ||
    'Adsız roman';
  const cover = root.querySelector('meta[property="og:image"]')?.getAttribute('content') || undefined;
  const description = root.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() || '';

  const seen = new Set<string>();
  const chapters: ChapterRef[] = [];
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href')!;
    const text = textOf(a);
    if (!CHAPTER_LINK.test(href) && !CHAPTER_LINK.test(text)) continue;
    const abs = absoluteUrl(href, url);
    let u: URL;
    try {
      u = new URL(abs);
    } catch {
      continue;
    }
    if (u.hostname !== host || abs === url || seen.has(abs)) continue;
    seen.add(abs);
    chapters.push({ url: abs, title: a.getAttribute('title')?.trim() || text || `Bölüm ${chapters.length + 1}` });
  }
  // Many sites list newest first; put chapter 1 at the top when the numbers show that.
  const num = (c: ChapterRef) => {
    const m = c.title.match(/(\d+)/) ?? c.url.match(/(\d+)(?!.*\d)/);
    return m ? parseInt(m[1], 10) : NaN;
  };
  if (chapters.length > 1 && num(chapters[0]) > num(chapters[chapters.length - 1])) chapters.reverse();

  return {
    sourceId: 'generic',
    url,
    title,
    description,
    coverUrl: cover ? absoluteUrl(cover, url) : undefined,
    language: root.querySelector('html')?.getAttribute('lang')?.slice(0, 2) || 'en',
    chapters,
  };
}

function biggestTextBlock(root: HTMLElement): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestScore = 0;
  for (const el of root.querySelectorAll('div, article, section, main')) {
    const ps = el.childNodes.filter((n) => (n as HTMLElement).tagName === 'P') as HTMLElement[];
    const score = ps.reduce((sum, p) => sum + p.text.length, 0);
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return bestScore > 200 ? best : null;
}

export function parseGenericChapter(html: string): ChapterContent {
  const root = parse(html);
  root.querySelectorAll('script, style, noscript, iframe, ins, nav, header, footer, form').forEach((e) => e.remove());
  let content: HTMLElement | null = null;
  for (const sel of CONTENT_SELECTORS) {
    const el = root.querySelector(sel);
    if (el && el.text.trim().length > 200) {
      content = el;
      break;
    }
  }
  content ??= biggestTextBlock(root);
  if (!content) throw new Error('Bu sayfada bölüm metni bulunamadı.');
  const title = textOf(root.querySelector('h1')) || textOf(root.querySelector('h2')) || '';
  const paragraphs = cleanParagraphs(htmlToParagraphs(content.innerHTML), title);
  if (paragraphs.length === 0) throw new Error('Bölüm metni boş geldi.');
  return { title, paragraphs };
}

export const generic: NovelSource = {
  id: 'generic',
  name: 'Genel (deneysel)',
  matches: () => true,
  async getNovel(url, http, onProgress) {
    onProgress?.({ message: 'Sayfa okunuyor…' });
    const info = parseGenericNovel(await http.getText(url), url);
    if (info.chapters.length === 0) throw new Error('Bu sayfada bölüm bağlantısı bulunamadı.');
    return info;
  },
  async getChapter(url, http) {
    return parseGenericChapter(await http.getText(url));
  },
};
