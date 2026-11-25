import { parse, type HTMLElement } from 'node-html-parser';

import { absoluteUrl, cleanParagraphs, htmlToParagraphs, sleep, textOf } from '../text';
import type { ChapterContent, ChapterRef, Http, NovelInfo } from '../types';
import type { NovelSource } from './types';

/**
 * NovelFull and sites built on the same theme
 * (novel page with `#list-chapter`, chapter body in `#chapter-content`).
 */
const HOSTS = ['novelfull.com', 'novelfull.net', 'allnovelfull.net', 'novelfull.to', 'readnovelfull.com'];

const CONTENT_SELECTORS = ['#chapter-content', '#chr-content', '.chapter-c', '#chapter-c', '.chapter-content'];
const JUNK_SELECTORS =
  'script, style, noscript, iframe, ins, form, button, .ads, .adsbygoogle, [class*="ads-"], [id*="ads"], div[align="left"], .chapter-nav, .chr-nav';

export function parseNovelPage(html: string, url: string): Omit<NovelInfo, 'chapters'> & {
  novelId?: string;
  chapters: ChapterRef[];
  lastPage: number;
} {
  const root = parse(html);
  const title =
    textOf(root.querySelector('h3.title')) ||
    textOf(root.querySelector('.books .title')) ||
    root.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ||
    textOf(root.querySelector('h1')) ||
    'Adsız roman';

  const authors = root
    .querySelectorAll('.info a[href*="author"], a[href*="/author/"]')
    .map((a) => textOf(a))
    .filter(Boolean);
  const author = [...new Set(authors)].join(', ');

  const coverEl = root.querySelector('.book img') ?? root.querySelector('.books img');
  const coverSrc =
    coverEl?.getAttribute('data-src') ||
    coverEl?.getAttribute('src') ||
    root.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
    undefined;

  const descEl = root.querySelector('.desc-text') ?? root.querySelector('.desc');
  const description = descEl ? htmlToParagraphs(descEl.innerHTML).join('\n') : '';

  const novelId =
    root.querySelector('#rating')?.getAttribute('data-novel-id') ||
    root.querySelector('[data-novel-id]')?.getAttribute('data-novel-id') ||
    undefined;

  return {
    sourceId: 'novelfull',
    url,
    title,
    author,
    description,
    coverUrl: coverSrc ? absoluteUrl(coverSrc, url) : undefined,
    language: 'en',
    novelId,
    chapters: parseChapterListPage(root, url),
    lastPage: parseLastPage(root),
  };
}

export function parseChapterListPage(root: HTMLElement, url: string): ChapterRef[] {
  const links = root.querySelectorAll('#list-chapter ul.list-chapter li a, ul.list-chapter li a');
  const seen = new Set<string>();
  const out: ChapterRef[] = [];
  for (const a of links) {
    const href = a.getAttribute('href');
    if (!href) continue;
    const abs = absoluteUrl(href, url);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push({ url: abs, title: a.getAttribute('title')?.trim() || textOf(a) || `Bölüm ${out.length + 1}` });
  }
  return out;
}

function parseLastPage(root: HTMLElement): number {
  const last = root.querySelector('#list-chapter .pagination li.last a, .pagination li.last a');
  const fromData = last?.getAttribute('data-page');
  if (fromData && /^\d+$/.test(fromData)) return parseInt(fromData, 10) + 1; // data-page is 0-based
  const href = last?.getAttribute('href') ?? '';
  const m = href.match(/[?&]page=(\d+)/);
  if (m) return parseInt(m[1], 10);
  let max = 1;
  for (const a of root.querySelectorAll('.pagination li a')) {
    const mm = (a.getAttribute('href') ?? '').match(/[?&]page=(\d+)/);
    if (mm) max = Math.max(max, parseInt(mm[1], 10));
  }
  return max;
}

/** Parses the `<select>` returned by `ajax-chapter-option`. */
export function parseChapterOptions(html: string, base: string): ChapterRef[] {
  const root = parse(html);
  const out: ChapterRef[] = [];
  const seen = new Set<string>();
  for (const opt of root.querySelectorAll('option')) {
    const value = opt.getAttribute('value');
    if (!value) continue;
    const abs = absoluteUrl(value, base);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push({ url: abs, title: textOf(opt) || `Bölüm ${out.length + 1}` });
  }
  return out;
}

export function parseChapterPage(html: string): ChapterContent {
  const root = parse(html);
  let content: HTMLElement | null = null;
  for (const sel of CONTENT_SELECTORS) {
    content = root.querySelector(sel);
    if (content) break;
  }
  if (!content) throw new Error('Bölüm metni sayfada bulunamadı.');
  content.querySelectorAll(JUNK_SELECTORS).forEach((el) => el.remove());
  const title =
    textOf(root.querySelector('a.chapter-title')) ||
    textOf(root.querySelector('.chapter-title')) ||
    textOf(root.querySelector('.chr-title')) ||
    textOf(root.querySelector('h2')) ||
    '';
  const paragraphs = cleanParagraphs(htmlToParagraphs(content.innerHTML), title);
  if (paragraphs.length === 0) throw new Error('Bölüm metni boş geldi.');
  return { title, paragraphs };
}

export const novelFull: NovelSource = {
  id: 'novelfull',
  name: 'NovelFull',
  matches(url) {
    const host = url.hostname.replace(/^www\./, '');
    return HOSTS.includes(host);
  },
  async getNovel(url, http, onProgress) {
    const novelUrl = url.split('#')[0].replace(/\?.*$/, '');
    onProgress?.({ message: 'Roman sayfası okunuyor…' });
    const page = await http.getText(novelUrl);
    const info = parseNovelPage(page, novelUrl);
    const origin = new URL(novelUrl).origin;

    let chapters: ChapterRef[] = [];
    if (info.novelId) {
      onProgress?.({ message: 'Bölüm listesi alınıyor…' });
      const id = encodeURIComponent(info.novelId);
      for (const path of [`/ajax-chapter-option?novelId=${id}`, `/ajax/chapter-option?novelId=${id}`]) {
        try {
          chapters = parseChapterOptions(await http.getText(origin + path), novelUrl);
        } catch {
          chapters = [];
        }
        if (chapters.length > 0) break;
      }
    }
    if (chapters.length < info.chapters.length) {
      // Fall back to walking the paginated chapter list.
      chapters = [...info.chapters];
      const seen = new Set(chapters.map((c) => c.url));
      for (let p = 2; p <= info.lastPage; p++) {
        onProgress?.({ message: `Bölüm listesi alınıyor… (sayfa ${p}/${info.lastPage})` });
        await sleep(600);
        const html = await http.getText(`${novelUrl}?page=${p}`);
        for (const c of parseChapterListPage(parse(html), novelUrl)) {
          if (!seen.has(c.url)) {
            seen.add(c.url);
            chapters.push(c);
          }
        }
      }
    }
    if (chapters.length === 0) throw new Error('Bölüm listesi bulunamadı.');
    const { novelId: _id, lastPage: _lp, ...rest } = info;
    return { ...rest, chapters };
  },
  async getChapter(url, http) {
    return parseChapterPage(await http.getText(url));
  },
};
