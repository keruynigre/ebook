// Run with: npx tsx tests/core.test.ts
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';

import { buildEpub, detectImageType } from '../src/lib/epub';
import { mergeGlossary, parseTranslation } from '../src/lib/gemini';
import { novelFull, parseChapterOptions, parseChapterPage, parseNovelPage } from '../src/lib/sources/novelfull';
import { parseGenericChapter, parseGenericNovel } from '../src/lib/sources/generic';
import { sourceForUrl } from '../src/lib/sources';
import { cleanParagraphs, htmlToParagraphs, slugify } from '../src/lib/text';
import type { Http } from '../src/lib/types';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n), 'utf8');
let failures = 0;
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}\n     ${(e as Error).stack}`);
  }
}

(async () => {
  await test('novel page parsing', () => {
    const n = parseNovelPage(fx('novel.html'), 'https://novelfull.com/test-novel.html');
    assert.equal(n.title, 'Test Novel');
    assert.equal(n.author, 'Jane Doe');
    assert.equal(n.coverUrl, 'https://novelfull.com/uploads/thumbs/test-novel.jpg');
    assert.equal(n.novelId, '1234');
    assert.equal(n.description, 'A young man & his sword.\nSecond line…');
    assert.equal(n.chapters.length, 2);
    assert.equal(n.chapters[0].url, 'https://novelfull.com/test-novel/chapter-1.html');
    assert.equal(n.lastPage, 3);
  });

  await test('chapter options parsing', () => {
    const c = parseChapterOptions(fx('options.html'), 'https://novelfull.com/test-novel.html');
    assert.equal(c.length, 3);
    assert.equal(c[2].title, 'Chapter 3 - Storm & Fire');
  });

  await test('chapter cleaning', () => {
    const c = parseChapterPage(fx('chapter.html'));
    assert.equal(c.title, 'Chapter 1 - Beginning');
    assert.deepEqual(c.paragraphs, [
      'The wind howled — “Run!” she said.',
      'He ran.',
      'And ran',
      'again.',
      '***',
      'Control char\\u0001 test done',
    ]);
  });

  await test('short dialogue is not mistaken for a title', () => {
    assert.deepEqual(cleanParagraphs(['Run.', 'Text'], 'Chapter 5: Run'), ['Run.', 'Text']);
    assert.deepEqual(htmlToParagraphs('<div>a<div>b</div>c</div>'), ['a', 'b', 'c']);
  });

  await test('source selection', () => {
    assert.equal(sourceForUrl('https://novelfull.com/x.html').id, 'novelfull');
    assert.equal(sourceForUrl('https://www.novelfull.com/x.html').id, 'novelfull');
    assert.equal(sourceForUrl('https://example.org/x').id, 'generic');
    assert.equal(slugify('Şeytan Çağı: İlk Bölüm!'), 'seytan-cagi-ilk-bolum');
  });

  await test('getNovel uses the ajax chapter list', async () => {
    const calls: string[] = [];
    const http: Http = {
      async getText(url) {
        calls.push(url);
        if (url.includes('ajax-chapter-option')) return fx('options.html');
        return fx('novel.html');
      },
      async getBytes() {
        return new Uint8Array();
      },
    };
    const n = await novelFull.getNovel('https://novelfull.com/test-novel.html?x=1', http);
    assert.equal(n.chapters.length, 3);
    assert.equal(calls[1], 'https://novelfull.com/ajax-chapter-option?novelId=1234');
    assert.ok(!('novelId' in n));
  });

  await test('getNovel falls back to pagination', async () => {
    const http: Http = {
      async getText(url) {
        if (url.includes('ajax')) throw new Error('404');
        const page = url.match(/page=(\d+)/)?.[1];
        if (!page) return fx('novel.html');
        return fx('novel.html').replace(/chapter-(\d)\.html/g, (_m, d) => `chapter-${page}${d}.html`);
      },
      async getBytes() {
        return new Uint8Array();
      },
    };
    const n = await novelFull.getNovel('https://novelfull.com/test-novel.html', http);
    assert.equal(n.chapters.length, 6);
  });

  await test('generic source', () => {
    const html = `<html lang="en"><head><title>My Book</title></head><body><h1>My Book</h1>
      <a href="/b/chapter-2">Chapter 2</a><a href="/b/chapter-1">Chapter 1</a><a href="https://other.com/chapter-9">x</a><a href="/about">About</a>
      <div class="post"><p>${'Long text. '.repeat(30)}</p><p>Second.</p></div></body></html>`;
    const n = parseGenericNovel(html, 'https://site.com/b');
    assert.deepEqual(n.chapters.map((c) => c.title), ['Chapter 1', 'Chapter 2']);
    const c = parseGenericChapter(html);
    assert.equal(c.paragraphs.at(-1), 'Second.');
  });

  await test('epub structure', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
    assert.deepEqual(detectImageType(jpeg), { mediaType: 'image/jpeg', ext: 'jpg' });
    const bytes = await buildEpub({
      meta: { id: 'abc', title: 'Test & <Novel>', author: 'Jane', description: 'Line 1\nLine 2', language: 'en', sourceUrl: 'https://novelfull.com/x.html?a=1&b=2' },
      chapters: [
        { title: 'Chapter 1', paragraphs: ['Hello "world" & <friends>', '***'] },
        { title: '', paragraphs: ['Second'] },
      ],
      cover: { bytes: jpeg, mediaType: 'image/jpeg', ext: 'jpg' },
      rangeLabel: 'Bölüm 1–2',
    });
    // mimetype must be the first entry, stored, with no extra field
    assert.equal(Buffer.from(bytes.slice(30, 38)).toString(), 'mimetype');
    assert.equal(bytes[8], 0); // compression method STORE
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);
    for (const n of ['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/toc.ncx', 'OEBPS/text/ch0001.xhtml', 'OEBPS/text/ch0002.xhtml', 'OEBPS/images/cover.jpg', 'OEBPS/text/cover.xhtml']) {
      assert.ok(names.includes(n), `missing ${n}`);
    }
    const ch2 = await zip.file('OEBPS/text/ch0002.xhtml')!.async('string');
    assert.match(ch2, /<h2>Bölüm 2<\/h2>/);
    const out = join(__dirname, 'out');
    require('node:fs').mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'test.epub'), bytes);
    for (const n of names.filter((n) => /\.(xhtml|opf|ncx|xml)$/.test(n))) {
      writeFileSync(join(out, n.replace(/\//g, '_')), await zip.file(n)!.async('string'));
    }
  });

  await test('translation parsing', () => {
    const orig = { title: 'Chapter 1', paragraphs: ['a', 'b', 'c'] };
    const r = parseTranslation('```json\n{"title":"Bölüm 1","paragraphs":["x","y"," z "],"newTerms":[{"source":"Qi","target":"Çi"},{"source":"","target":"x"}]}\n```', orig);
    assert.equal(r.chapter.title, 'Bölüm 1');
    assert.deepEqual(r.chapter.paragraphs, ['x', 'y', 'z']);
    assert.deepEqual(r.newTerms, [{ source: 'Qi', target: 'Çi' }]);
    assert.throws(() => parseTranslation('{"title":"t","paragraphs":["x"]}', orig), /eksik/);
    assert.throws(() => parseTranslation('not json', orig));
    const g = mergeGlossary([{ source: 'Qi', target: 'Çi' }], [{ source: 'qi', target: 'Ki' }, { source: 'Dao', target: 'Dao' }]);
    assert.deepEqual(g.map((x) => x.target), ['Çi', 'Dao']);
  });

  console.log(failures ? `\n${failures} test(s) failed` : '\nall tests passed');
  process.exit(failures ? 1 : 0);
})();
