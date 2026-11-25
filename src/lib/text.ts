import type { HTMLElement } from 'node-html-parser';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', bull: '•', middot: '·',
  copy: '©', reg: '®', trade: '™', deg: '°', times: '×', shy: '',
  zwj: '', zwnj: '', lrm: '', rlm: '',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (!Number.isFinite(n) || n > 0x10ffff || (n < 32 && n !== 9 && n !== 10 && n !== 13)) return '';
      try {
        return String.fromCodePoint(n);
      } catch {
        return '';
      }
    }
    const v = NAMED_ENTITIES[code.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/** Characters that are invalid in XML 1.0 documents. */
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function escapeXml(s: string): string {
  return s
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function normalizeSpace(s: string): string {
  return s.replace(/[\s ​﻿]+/g, ' ').trim();
}

/** Plain text of an element, entities decoded and whitespace collapsed. */
export function textOf(el: HTMLElement | null | undefined): string {
  if (!el) return '';
  return normalizeSpace(decodeEntities(el.innerHTML.replace(/<[^>]+>/g, ' ')));
}

const BLOCK = '(?:p|div|h[1-6]|li|ul|ol|blockquote|section|article|tr|table|center)';

/**
 * Turns the HTML of a chapter body into paragraphs of plain text.
 * Handles both <p>-based and <br>-based layouts.
 */
export function htmlToParagraphs(html: string): string[] {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|iframe|ins|svg|button|form)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\b[^>]*>/gi, '\n***\n')
    .replace(new RegExp(`<\\/?${BLOCK}\\b[^>]*>`, 'gi'), '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .split(/\n+/)
    .map(normalizeSpace)
    .filter((p) => p.length > 0);
}

const JUNK_PATTERNS: RegExp[] = [
  /^(translator|translated by|editor|edited by|proofreader|tl|ed|tl ?note|t\/n)s?\s*[:：-]/i,
  /\b(novel ?full|novelbin|allnovel|readnovelfull|freewebnovel|lightnovel\w*|wuxiaworld|webnovel|boxnovel)\.(com|net|org|me|cc|co)\b/i,
  /read (the )?(latest|new|more|next|full) (chapters?|novels?)/i,
  /if you find any errors/i,
  /tip: you can use (left|right)/i,
  /^(previous|prev|next)( chapter)?$/i,
  /^(table of contents|toc|index|report chapter|chapter list)$/i,
  /this chapter (is |was )?(upload|update)/i,
  /(patreon\.com|ko-fi\.com|discord\.gg)/i,
  /^advertisement$/i,
];

/** Removes site boilerplate and a heading that duplicates the chapter title. */
export function cleanParagraphs(paragraphs: string[], chapterTitle?: string): string[] {
  const out = paragraphs.filter((p) => !(p.length < 220 && JUNK_PATTERNS.some((re) => re.test(p))));
  // Drop leading paragraphs that just repeat the chapter title.
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const titleNorm = chapterTitle ? norm(chapterTitle) : '';
  while (out.length > 0) {
    const first = out[0];
    const firstNorm = norm(first);
    const sameAsTitle =
      titleNorm.length > 0 &&
      (firstNorm === titleNorm ||
        (firstNorm.length >= 8 && titleNorm.includes(firstNorm)) ||
        (titleNorm.length >= 8 && firstNorm.startsWith(titleNorm)));
    const looksLikeHeading = /^(chapter|bölüm|ch\.?)\s*\d+\b/i.test(first) && first.length < 100;
    const isTitle = first.length < 150 && (sameAsTitle || looksLikeHeading);
    if (!isTitle || !firstNorm) break;
    out.shift();
  }
  return out;
}

export function absoluteUrl(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Short stable hash (FNV-1a) used for ids. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function slugify(s: string, max = 40): string {
  const map: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
  return (
    s
      .replace(/İ/g, 'i')
      .toLowerCase()
      .replace(/[çğıöşü]/g, (c) => map[c] ?? c)
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/g, '') || 'kitap'
  );
}

/** A file name that is safe on Android and readable for people. */
export function safeFileName(s: string, max = 80): string {
  return normalizeSpace(s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')).slice(0, max).trim() || 'kitap';
}
