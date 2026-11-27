// Run with: npx tsx tests/core.test.ts
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';

import { buildEpub, detectImageType } from '../src/lib/epub';
import { GeminiError, mergeGlossary, parseTranslation, translateChapter } from '../src/lib/gemini';
import { ModelPool } from '../src/lib/modelPool';
import { novelFull, parseChapterOptions, parseChapterPage, parseNovelPage } from '../src/lib/sources/novelfull';
import { parseGenericChapter, parseGenericNovel } from '../src/lib/sources/generic';
import { sourceForUrl } from '../src/lib/sources';
import { cleanParagraphs, htmlToParagraphs, slugify } from '../src/lib/text';
import type { Http } from '../src/lib/types';
import { chapterCost, comicSystem, panelRange } from '../src/lib/comicCore';
import { countWords, formatCount, pastReading, recordRead, summarize, wordsRead } from '../src/lib/readStats';
import {
  edgeDate,
  fullVoiceName,
  locateWords,
  makeSsml,
  parseBinaryFrame,
  parseMetadata,
  parseTextFrame,
  secMsGecInput,
  splitForSpeech,
  synthesize,
} from '../src/lib/tts/edge';
import { mp3Duration, trimMp3 } from '../src/lib/tts/mp3';
import { randomUUID } from 'node:crypto';
import { secMsGecV2 } from '../src/lib/tts/drm';
import { parseGoogleDictionary, parseTdk, turkishStems } from '../src/lib/dictionaryParse';
import { tokenize } from '../src/lib/words';
import { ZipWriter, crc32 } from '../src/lib/zipCore';
import { multipartBody } from '../src/lib/multipart';
import { base64ImageExt, coverPrompt, coverRequest } from '../src/lib/coverCore';
import { searchParagraphs } from '../src/lib/searchCore';
import { compareVersions, versionFromTag } from '../src/lib/updateCore';
import { cardPrompt, castNames, comicRequest, mergeCast, panelPrompt, panelSlots, parseComicScript } from '../src/lib/comicCore';
import { aliasesFor, needsProfile, parseProfiles, profileFor, autoChapters, betterName, chapterNeedsWork, isLabel, knownCharacterList, mergeCharacterGroups, clearChapterNotes, displayName, dropTurkishNames, emptyNotebook, findCharacter, isTurkishName, mergeChapterInfo, noteText } from '../src/lib/notebookCore';

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
        { title: 'Chapter 1', paragraphs: ['Hello "world" & <friends>', '***'], notes: ['Not: <alt> & x'] },
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
    const ch1 = await zip.file('OEBPS/text/ch0001.xhtml')!.async('string');
    assert.match(ch1, /Çevirmen notları[\s\S]*Not: &lt;alt&gt; &amp; x/);
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
    const withNotes = parseTranslation('{"title":"B","paragraphs":["x","y","z"],"notes":["Not: alternatif",""]}', orig);
    assert.deepEqual(withNotes.chapter.notes, ['Not: alternatif']);
    assert.equal(r.chapter.notes, undefined);
    assert.throws(() => parseTranslation('{"title":"t","paragraphs":["x"]}', orig), /eksik/);
    assert.throws(() => parseTranslation('not json', orig));
    const g = mergeGlossary([{ source: 'Qi', target: 'Çi' }], [{ source: 'qi', target: 'Ki' }, { source: 'Dao', target: 'Dao' }]);
    assert.deepEqual(g.map((x) => x.target), ['Çi', 'Dao']);
  });

  await test('model pool falls back to the next model', () => {
    let t = 0;
    const pool = new ModelPool('models/a', ['models/a', 'models/b', 'models/c'], () => t);
    assert.deepEqual(pool.pick(), { model: 'models/a' });
    pool.report('models/a', 'busy');
    assert.deepEqual(pool.pick(), { model: 'models/b' });
    pool.report('models/b', 'daily');
    pool.report('models/c', 'rate', 10_000);
    assert.deepEqual(pool.pick(), { waitMs: 10_000 });
    t = 10_000;
    assert.deepEqual(pool.pick(), { model: 'models/c' });
    t = 60_000;
    assert.deepEqual(pool.pick(), { model: 'models/a' });
    pool.report('models/a', 'daily');
    pool.report('models/c', 'daily');
    assert.equal(pool.pick(), null);
  });

  await test('gemini request falls back when a model rejects options', async () => {
    const realFetch = globalThis.fetch;
    const bodies: any[] = [];
    const ok = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Tamam: {"title":"B1","paragraphs":["a","b"]}' }] } }] };
    globalThis.fetch = (async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      const rejected = body.generationConfig.thinkingConfig || body.safetySettings || body.generationConfig.responseSchema;
      return new Response(JSON.stringify(rejected ? { error: { message: 'Request contains an invalid argument.' } } : ok), {
        status: rejected ? 400 : 200,
      });
    }) as any;
    try {
      const orig = { title: 'C1', paragraphs: ['x', 'y'] };
      const r = await translateChapter('k', 'models/test-a', orig, [], 'Book');
      assert.deepEqual(r.chapter.paragraphs, ['a', 'b']);
      assert.equal(bodies.length, 4);
      // The next chapter starts with the shape that worked.
      await translateChapter('k', 'models/test-a', orig, [], 'Book');
      assert.equal(bodies.length, 5);
      globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 400 })) as any;
      await assert.rejects(translateChapter('k', 'models/test-b', orig, [], 'Book'), (e: unknown) => e instanceof GeminiError && e.kind === 'unsupported');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  await test('edge tts protocol helpers', () => {
    assert.equal(secMsGecInput(1700000000), '133444734000000000' + '6A5AA1D4EAFF4E9FB37E23D68491D6F4');
    assert.equal(secMsGecInput(1700000099), secMsGecInput(1700000000));
    assert.equal(fullVoiceName('tr-TR-AhmetNeural'), 'Microsoft Server Speech Text to Speech Voice (tr-TR, AhmetNeural)');
    assert.equal(fullVoiceName('en-US-AndrewMultilingualNeural'), 'Microsoft Server Speech Text to Speech Voice (en-US, AndrewMultilingualNeural)');
    assert.equal(edgeDate(new Date(Date.UTC(2026, 10, 5, 7, 3, 9))), 'Thu Nov 05 2026 07:03:09 GMT+0000 (Coordinated Universal Time)');
    const ssml = makeSsml('A & <b> "c"', { voice: 'tr-TR-EmelNeural' });
    assert.ok(ssml.includes('A &amp; &lt;b&gt; &quot;c&quot;'));
    assert.ok(ssml.includes("rate='+0%'"));
    assert.deepEqual(parseTextFrame('X-RequestId:1\r\nPath:turn.end\r\n\r\n{}'), { path: 'turn.end', body: '{}' });
    const head = 'X-RequestId:1\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n';
    const frame = new Uint8Array([0, head.length, ...Buffer.from(head), 9, 8, 7]);
    const b = parseBinaryFrame(frame);
    assert.equal(b.path, 'audio');
    assert.deepEqual([...b.audio], [9, 8, 7]);
    const words = parseMetadata(
      JSON.stringify({
        Metadata: [
          { Type: 'WordBoundary', Data: { Offset: 1000000, Duration: 4000000, text: { Text: 'Merhaba' } } },
          { Type: 'SentenceBoundary', Data: { Offset: 0, Duration: 0 } },
        ],
      }),
    );
    assert.deepEqual(words, [{ text: 'Merhaba', start: 0.1, end: 0.5 }]);
  });

  await test('edge tts v2 token matches edge-tts 7.3.1', () => {
    // Reference values produced by edge_tts.drm.generate_sec_ms_gec_v2 (Python).
    assert.equal(
      secMsGecV2(secMsGecInput(1700000000)),
      '2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2',
    );
    assert.equal(
      secMsGecV2(secMsGecInput(1764100000)),
      '005202A2C6B3CBE3-1975F4BB4B2FFD193E319C7A3EFB09A584E4B57CAC7A6F306805C00D1196B80D',
    );
    assert.equal(
      secMsGecV2(secMsGecInput(1800000000.7)),
      '99E54519B490BE5C-E162DB0977FBDCB9B86DD8148BF1BCDC3C0303176CE39852A42B415935C20654',
    );
  });

  await test('word bubble: tokens and dictionary parsing', () => {
    const t = tokenize('“Adı Bai Xiaochun’du,” dedi. Well-known!');
    assert.deepEqual(t.filter((x) => x.word).map((x) => x.text), ['Adı', 'Bai', 'Xiaochun’du', 'dedi', 'Well-known']);
    assert.equal(t.map((x) => x.text).join(''), '“Adı Bai Xiaochun’du,” dedi. Well-known!');
    const g = parseGoogleDictionary('village', [
      [['köy', 'village', null, null, 10]],
      [['noun', ['köy', 'kasaba'], [], 'village', 1]],
      'en',
    ]);
    assert.equal(g?.translation, 'köy');
    assert.deepEqual(g?.senses, [{ label: 'isim', items: ['köy', 'kasaba'] }]);
    assert.equal(parseGoogleDictionary('xyz', [[['xyz', 'xyz']], null, 'en']), null);
    const d = parseTdk('köylüler', [
      { madde: 'köylü', anlamlarListe: [{ anlam: 'Köyde oturan kimse', ozelliklerListe: [{ tam_adi: 'isim' }] }] },
    ]);
    assert.equal(d?.headword, 'köylü');
    assert.deepEqual(d?.senses, [{ label: 'isim', items: ['Köyde oturan kimse'] }]);
    assert.equal(parseTdk('x', { error: 'Sonuç bulunamadı' }), null);
    assert.deepEqual(turkishStems('Köylüler').slice(0, 4), ['köylüler', 'köylüle', 'köylül', 'köylü']);
    assert.equal(turkishStems('Xiaochun’du')[0], 'xiaochun');
  });

  await test('story notebook merging', () => {
    let nb = mergeChapterInfo(emptyNotebook(), 0, {
      summary: 'Bai Xiaochun köyden ayrılır.',
      characters: [{ name: 'Bai Xiaochun', description: 'On beş yaşında, zayıf, yeşil cübbeli bir genç.' }],
    });
    nb = mergeChapterInfo(nb, 1, {
      summary: 'Tarikata varır.',
      characters: [
        { name: 'Xiaochun', description: 'Ölümden çok korkar.' },
        { name: 'Li Qinghou', description: 'Tarikatın yaşlı ustası.' },
      ],
    });
    // Re-processing chapter 1 replaces its note instead of piling up.
    nb = mergeChapterInfo(nb, 1, { characters: [{ name: 'Bai Xiaochun', description: 'Ölümden ödü kopar.' }] });
    assert.equal(nb.characters.length, 2);
    const bai = nb.characters[findCharacter(nb.characters, 'xiaochun')];
    assert.equal(bai.name, 'Bai Xiaochun');
    assert.deepEqual(bai.aliases, ['Xiaochun']);
    assert.deepEqual(bai.seenIn, [0, 1]);
    assert.deepEqual(bai.notes.map((n) => n.chapter), [0, 1]);
    assert.equal(bai.notes[1].text, 'Ölümden ödü kopar.');
    assert.equal(nb.summaries['0'], 'Bai Xiaochun köyden ayrılır.');
    assert.equal(nb.summaries['1'], 'Tarikata varır.');
    assert.equal(findCharacter(nb.characters, 'Qinghou'), 1);
    assert.equal(findCharacter(nb.characters, 'Bilinmeyen'), -1);
  });

  await test('notebook keeps both languages', () => {
    const nb = mergeChapterInfo(emptyNotebook(), 3, {
      summary: 'Köye döner.',
      summaryEn: 'He returns to the village.',
      characters: [{ name: 'Ali', description: 'Uzun boylu.', descriptionEn: 'Tall.' }],
    });
    assert.equal(nb.summariesEn?.['3'], 'He returns to the village.');
    assert.equal(noteText(nb.characters[0].notes[0], 'en'), 'Tall.');
    assert.equal(noteText(nb.characters[0].notes[0], 'tr'), 'Uzun boylu.');
    assert.equal(noteText({ chapter: 0, text: 'Sadece Türkçe' }, 'en'), 'Sadece Türkçe');
  });

  await test('nicknames and labels join the same character', () => {
    assert.equal(isLabel("Tie Zhu's Father"), true);
    assert.equal(isLabel('Fourth Uncle'), true);
    assert.equal(isLabel('Wang Tianshui'), false);
    assert.equal(betterName('Wang Tianshui', "Tie Zhu's Father"), true);
    assert.equal(betterName("Tie Zhu's Father's Fourth Younger Brother", 'Fourth Uncle'), false);
    let nb = mergeChapterInfo(emptyNotebook(), 0, {
      summary: 'Başlangıç.',
      characters: [
        { name: 'Tie Zhu', description: 'Zeki köy çocuğu.' },
        { name: "Tie Zhu's Father", description: 'Marangoz.' },
        { name: "Wang Lin's Father", description: 'Gururlu baba.' },
      ],
    });
    assert.equal(nb.characters.length, 3);
    // A later chapter gives real names and the other names as aliases: the records are joined.
    nb = mergeChapterInfo(nb, 1, {
      summary: 'Devam.',
      characters: [
        { name: 'Wang Lin', aliases: ['Tie Zhu'], description: 'Asıl adı Wang Lin.' },
        { name: 'Wang Tianshui', aliases: ["Tie Zhu's Father", "Wang Lin's Father", 'Lao Er'], description: 'Wang Lin’in babası.' },
      ],
    });
    assert.deepEqual(nb.characters.map((c) => c.name).sort(), ['Wang Lin', 'Wang Tianshui']);
    const father = nb.characters.find((c) => c.name === 'Wang Tianshui')!;
    assert.ok(father.aliases.includes("Tie Zhu's Father") && father.aliases.includes("Wang Lin's Father") && father.aliases.includes('Lao Er'));
    assert.deepEqual(father.seenIn, [0, 1]);
    assert.equal(father.notes.length, 3);
    assert.equal(nb.characters.find((c) => c.name === 'Wang Lin')!.firstChapter, 0);
    assert.ok(knownCharacterList(nb).some((x) => x.startsWith('Wang Lin (Tie Zhu')));
    // Groups found later (or chosen by hand) are joined too; the real name stays the main one.
    let nb2 = mergeChapterInfo(emptyNotebook(), 0, {
      characters: [{ name: 'Fourth Uncle', description: 'Tavsiye hakkı var.' }, { name: "Tie Zhu's Father's Fourth Younger Brother", description: 'Ev sahibi.' }, { name: 'Zhang', description: '' }],
    });
    nb2 = mergeCharacterGroups(nb2, [['Fourth Uncle', "Tie Zhu's Father's Fourth Younger Brother"], ['Nobody', 'Zhang']]);
    assert.deepEqual(nb2.characters.map((c) => c.name), ['Fourth Uncle', 'Zhang']);
    assert.deepEqual(nb2.characters[0].aliases, ["Tie Zhu's Father's Fourth Younger Brother"]);
    assert.equal(nb2.characters[0].notes.length, 2);
  });

  await test('notebook fills itself only when kept from the first chapter', () => {
    const fromStart = { characters: [], summaries: { '0': 'Başlangıç.' }, summariesEn: {} };
    const midStory = { characters: [], summaries: { '400': 'Orta.' }, summariesEn: {} };
    assert.deepEqual(autoChapters(fromStart, [41], 41), [41]);
    assert.deepEqual(autoChapters(fromStart, [39, 40, 41], 41), [39, 40, 41]);
    assert.deepEqual(autoChapters(fromStart, [10, 20, 30, 41], 41), []);
    assert.deepEqual(autoChapters(fromStart, [], 41), []);
    assert.deepEqual(autoChapters(midStory, [401], 401), []);
    assert.deepEqual(autoChapters(emptyNotebook(), [0, 1], 1), [0, 1]);
    assert.deepEqual(autoChapters(emptyNotebook(), [499, 500], 500), []);
  });

  await test('old one-language notebook chapters are redone for the reader language', () => {
    const nb = {
      characters: [],
      summaries: { '0': 'Chu Yang dies on the mountain and wakes up years earlier.', '1': 'Köye döner ve eski dostunu görür.', '2': '—' },
      summariesEn: {},
      noCast: [0, 1],
    };
    assert.equal(chapterNeedsWork(nb, 0, 'tr'), true);
    assert.equal(chapterNeedsWork(nb, 1, 'tr'), false);
    assert.equal(chapterNeedsWork(nb, 1, 'en'), true);
    assert.equal(chapterNeedsWork(nb, 2, 'en'), false);
    assert.equal(chapterNeedsWork(nb, 5, 'tr'), true);
    const withNote = {
      characters: [{ name: 'Chu Yang', aliases: [], notes: [{ chapter: 1, text: 'Genç bir mürit.' }], firstChapter: 1, lastChapter: 1, seenIn: [1] }],
      summaries: { '1': 'Köye döner.' },
      summariesEn: { '1': 'He returns.' },
    };
    assert.equal(chapterNeedsWork(withNote, 1, 'tr'), false);
    assert.equal(chapterNeedsWork(withNote, 1, 'en'), true);
    assert.equal(clearChapterNotes(withNote, 1).characters[0].notes.length, 0);
    // Saved without characters by an older version: redone; checked and empty: kept.
    const noChars = { characters: [], summaries: { '1': 'Köye döner.' }, summariesEn: { '1': 'He returns.' } };
    assert.equal(chapterNeedsWork(noChars, 1, 'tr'), true);
    const checked = mergeChapterInfo(noChars, 1, { summary: 'Köye döner.', summaryEn: 'He returns.', characters: [] });
    assert.equal(chapterNeedsWork(checked, 1, 'tr'), false);
    const found = mergeChapterInfo(checked, 1, { summary: 'Köye döner.', characters: [{ name: 'Ali', description: '' }] });
    assert.deepEqual(found.noCast, []);
    assert.equal(chapterNeedsWork(found, 1, 'tr'), false);
    assert.equal(noteText({ chapter: 0, text: 'Known as the Poisonous Sword Revered Martial Artist', en: 'x' }, 'tr'), 'x');
  });

  await test('comic script parsing and panel prompts', () => {
    const { script, cast } = parseComicScript(4, {
      panels: [
        { scene: 'Wide shot of a misty mountain sect.', characters: ['Chu Yang'], bubbles: [{ kind: 'speech', speaker: 'Chu Yang', tr: 'Geri döndüm.', en: '' }] },
        { scene: '', characters: [], bubbles: [] },
        { scene: 'Close-up.', characters: ['Mo Qing Wu'], bubbles: [{ kind: 'narration', speaker: 'x', tr: '', en: 'Years earlier.' }] },
      ],
      cast: [{ name: 'Chu Yang', look: 'young man, long black hair tied up, sharp eyes, plain disciple robe' }],
    });
    assert.equal(script.chapter, 4);
    assert.equal(script.panels.length, 2);
    assert.equal(script.panels[0].bubbles[0].en, 'Geri döndüm.');
    assert.equal(script.panels[1].bubbles[0].speaker, '');
    assert.equal(script.panels[1].bubbles[0].tr, 'Years earlier.');
    const merged = mergeCast({ 'chu yang': 'old look' }, cast);
    assert.equal(Object.keys(merged).length, 1);
    const prompt = panelPrompt(script.panels[0], cast);
    assert.ok(prompt.includes('long black hair'));
    assert.ok(prompt.includes('black and white'));
    assert.ok(prompt.length <= 1900);
    const withRefs = panelPrompt(script.panels[0], cast, true, { style: true, cards: ['Chu Yang'] });
    assert.ok(withRefs.startsWith('Draw in the art style of image 0'));
    assert.ok(withRefs.includes('image 1 is Chu Yang'));
    assert.ok(withRefs.includes('full color'));
    assert.deepEqual(castNames({ scene: 'x', characters: ['chu yang', 'Nobody'], bubbles: [] }, cast), ['Chu Yang']);
    assert.ok(cardPrompt('Chu Yang', cast['Chu Yang']).includes('plain white background'));
    const long = panelPrompt({ scene: 'x'.repeat(3000), characters: ['Chu Yang'], bubbles: [] }, cast);
    assert.ok(long.length <= 1900 && long.endsWith('no watermark'));
  });

  await test('translation carries notebook info', () => {
    const r = parseTranslation(
      JSON.stringify({
        title: 'T',
        paragraphs: ['a'],
        summary: 'Özet',
        summary_en: 'Summary',
        characters: [{ name: 'Ali', description: 'Uzun boylu', description_en: 'Tall' }, { name: '' }],
      }),
      { title: 'T', paragraphs: ['x'] },
    );
    assert.equal(r.info.summary, 'Özet');
    assert.equal(r.info.summaryEn, 'Summary');
    assert.deepEqual(r.info.characters, [{ name: 'Ali', description: 'Uzun boylu', descriptionEn: 'Tall' }]);
  });

  await test('word locating and long paragraph splitting', () => {
    const text = '“Well, I got permission,” he said. Done!';
    const loc = locateWords(text, [
      { text: 'Well', start: 0, end: 0.2 },
      { text: 'I', start: 0.3, end: 0.4 },
      { text: '???', start: 0.5, end: 0.6 },
      { text: 'permission', start: 0.7, end: 1 },
      { text: 'Done', start: 2, end: 2.2 },
    ]);
    assert.deepEqual(loc.map((w) => text.slice(w.start, w.end)), ['Well', 'I', 'permission', 'Done']);
    const long = Array.from({ length: 80 }, (_, k) => `Cümle numarası ${k} burada bitiyor.`).join(' ');
    const parts = splitForSpeech(long, 500);
    assert.ok(parts.length > 3);
    assert.equal(parts.map(([, t]) => t).join(''), long);
    for (const [off, t] of parts) {
      assert.ok(t.length <= 500);
      assert.equal(long.slice(off, off + t.length), t);
      assert.match(t.trimEnd(), /\.$/);
    }
    assert.deepEqual(splitForSpeech('kısa'), [[0, 'kısa']]);
  });

  await test('mp3 trimming', () => {
    // MPEG2 layer III, 48 kbit/s, 24 kHz: 144-byte frames of 24 ms (Edge's format).
    const frame = new Uint8Array(144);
    frame.set([0xff, 0xf3, 0x64, 0xc4]);
    const data = new Uint8Array(144 * 100);
    for (let k = 0; k < 100; k++) data.set(frame, k * 144);
    assert.ok(Math.abs(mp3Duration(data) - 2.4) < 1e-6);
    const cut = trimMp3(data, 1.0);
    assert.equal(cut.length % 144, 0);
    assert.ok(Math.abs(mp3Duration(cut) - 0.984) < 1e-6);
  });

  await test('edge tts synthesis over a fake socket', async () => {
    const sent: string[] = [];
    let opened = '';
    let hdrs: Record<string, string> = {};
    const res = await synthesize('Merhaba dünya', { voice: 'tr-TR-AhmetNeural' }, {
      uuid: randomUUID,
      openSocket: (url, headers) => {
        opened = url;
        hdrs = headers;
        const ws: any = {
          binaryType: '',
          send: (d: string) => {
            sent.push(d);
            if (sent.length === 2) {
              const head = 'Path:audio\r\n';
              const bin = (bytes: number[]) => new Uint8Array([0, head.length, ...Buffer.from(head), ...bytes]).buffer;
              setTimeout(() => {
                ws.onmessage({ data: 'Path:turn.start\r\n\r\n{}' });
                ws.onmessage({ data: bin([1, 2]) });
                ws.onmessage({
                  data:
                    'Path:audio.metadata\r\n\r\n' +
                    JSON.stringify({ Metadata: [{ Type: 'WordBoundary', Data: { Offset: 500000, Duration: 2000000, text: { Text: 'Merhaba' } } }] }),
                });
                ws.onmessage({ data: bin([3]) });
                ws.onmessage({ data: 'Path:turn.end\r\n\r\n' });
              }, 1);
            }
          },
          close: () => undefined,
        };
        setTimeout(() => ws.onopen(), 1);
        return ws;
      },
    });
    assert.deepEqual([...res.audio], [1, 2, 3]);
    assert.deepEqual(res.words, [{ text: 'Merhaba', start: 0.05, end: 0.25 }]);
    assert.match(opened, /^wss:\/\/speech\.platform\.bing\.com\/.*TrustedClientToken=.*&ConnectionId=[0-9a-f]{32}&Sec-MS-GEC=[0-9A-F]{16}-[0-9A-F]{64}&Sec-MS-GEC-Version=2-/);
    assert.equal(hdrs.Origin, 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold');
    assert.match(sent[0], /Path:speech\.config/);
    assert.match(sent[1], /Path:ssml\r\n\r\n<speak .*AhmetNeural.*Merhaba dünya/);
  });

  await test('notebook names: original vs Turkish', () => {
    assert.equal(isTurkishName("Tie Zhu'nun Babası"), true);
    assert.equal(isTurkishName("Chu Yang'ın Ustası"), true);
    assert.equal(isTurkishName("Tie Zhu's Father"), false);
    assert.equal(isTurkishName('Lü Bu'), false);
    assert.equal(isTurkishName("Chang'e"), false);
    let nb = mergeChapterInfo(emptyNotebook(), 0, {
      summary: 'x',
      characters: [
        { name: "Tie Zhu's Father", nameTr: "Tie Zhu'nun Babası", description: '' },
        { name: 'Tie Zhu', nameTr: 'Tie Zhu', description: '' },
      ],
    });
    assert.equal(nb.characters.length, 2, 'the son is not merged into the father');
    assert.equal(displayName(nb.characters[0], 'tr'), "Tie Zhu'nun Babası");
    assert.equal(displayName(nb.characters[0], 'en'), "Tie Zhu's Father");
    assert.equal(findCharacter(nb.characters, "Tie Zhu'nun Babası"), 0);
    const old = {
      characters: [
        { name: "Tie Zhu'nun Babası", aliases: ['Tie Zhu'], notes: [{ chapter: 1, text: 'a' }], firstChapter: 1, lastChapter: 1, seenIn: [1] },
        { name: 'Wang Zhuo', aliases: [], notes: [{ chapter: 1, text: 'b' }, { chapter: 2, text: 'c' }], firstChapter: 1, lastChapter: 2, seenIn: [1, 2] },
      ],
      summaries: { '1': 'bir', '2': 'iki' },
      summariesEn: { '1': 'one', '2': 'two' },
    };
    nb = dropTurkishNames(old);
    assert.deepEqual(nb.characters.map((c) => c.name), ['Wang Zhuo']);
    assert.deepEqual(nb.characters[0].notes.map((n) => n.chapter), [2]);
    assert.deepEqual(Object.keys(nb.summaries), ['2']);
    assert.equal(dropTurkishNames(nb), nb);
  });

  await test('pictures are placed under their paragraphs', () => {
    const { script } = parseComicScript(
      2,
      {
        panels: [
          { paragraph: 30, scene: 'Later.', characters: [] },
          { paragraph: 3, scene: 'Chu Yang speaks.', characters: ['Chu Yang'] },
          { paragraph: 99, scene: 'Past the end.', characters: [] },
        ],
        cast: [],
      },
      40,
    );
    assert.deepEqual(script.panels.map((p) => p.para), [3, 30, 39]);
    const slots = panelSlots(script, 40);
    assert.deepEqual([...slots.entries()], [[3, [0]], [30, [1]], [39, [2]]]);
    // Older scripts without paragraph numbers are spread over the chapter.
    const old = panelSlots({ chapter: 1, panels: [{ scene: 'a', characters: [], bubbles: [] }, { scene: 'b', characters: [], bubbles: [] }, { scene: 'c', characters: [], bubbles: [] }] }, 8);
    assert.deepEqual([...old.entries()], [[2, [0]], [4, [1]], [6, [2]]]);
    const req = comicRequest('Kitap', 'Bölüm 3', ['İlk.', 'İkinci.'], {}, [], ['Wang Lin', 'Zhang']);
    assert.ok(req.includes('[1] İkinci.') && req.includes('Wang Lin, Zhang'));
  });

  await test('comic quality presets', () => {
    assert.match(comicSystem([3, 4]), /"panels": 3 to 4 pictures/);
    assert.match(comicSystem(panelRange('saver', 8)), /"panels": exactly 8 pictures/);
    assert.deepEqual(panelRange('high'), [6, 8]);
    assert.ok(chapterCost('saver', 10) > chapterCost('saver'));
    assert.ok(chapterCost('saver') < chapterCost('balanced') && chapterCost('balanced') < chapterCost('high'));
  });

  await test('update versions', () => {
    assert.equal(versionFromTag('v1.0.21-build.41'), '1.0.21');
    assert.ok(compareVersions('1.0.22', '1.0.21') > 0);
    assert.ok(compareVersions('1.0.9', '1.0.10') < 0);
    assert.equal(compareVersions('1.0.21', '1.0.21'), 0);
  });

  await test('search in chapters', () => {
    const paras = ['Wang Lin baktı.', 'İhtiyar adam, "Tie Zhu!" diye bağırdı ve köye doğru yürüdü.', 'Hiçbir şey.'];
    const hits = searchParagraphs(paras, 'tie zhu', 'tr', 10);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].para, 1);
    assert.equal(hits[0].snippet.slice(hits[0].start, hits[0].start + hits[0].length), 'Tie Zhu');
    assert.ok(hits[0].snippet.startsWith('…') && hits[0].snippet.endsWith('…'));
    assert.equal(searchParagraphs(paras, 'ihtiyar', 'tr').length, 1);
    assert.equal(searchParagraphs(['In the sect.'], 'in', 'en').length, 1);
    assert.equal(searchParagraphs(paras, 'a', 'tr').length, 0);
  });

  await test('multipart body', () => {
    const { body, contentType } = multipartBody([['prompt', 'Wang Lin']], [{ name: 'input_image_0', filename: 'ref0.jpg', data: new Uint8Array([1, 2, 3]) }], 'XX');
    assert.equal(contentType, 'multipart/form-data; boundary=XX');
    const text = new TextDecoder('latin1').decode(body);
    assert.equal(
      text,
      '--XX\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nWang Lin\r\n--XX\r\nContent-Disposition: form-data; name="input_image_0"; filename="ref0.jpg"\r\nContent-Type: image/jpeg\r\n\r\n\x01\x02\x03\r\n--XX--\r\n',
    );
  });

  await test('zip writer', async () => {
    assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
    const w = new ZipWriter();
    const text = JSON.stringify({ p: ['Wang Lin şöyle dedi: “Gel.”'.repeat(200)] });
    const pic = new Uint8Array(500).map((_, i) => (i * 7) % 256);
    const chunks = [...w.add('books/a/chapters/1.json', new TextEncoder().encode(text)), ...w.add('books/a/comic/1/0.jpg', pic), ...w.add('settings.json', new TextEncoder().encode('{}'))];
    chunks.push(w.finish());
    const all = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
    let o = 0;
    for (const c of chunks) all.set(c, (o += c.length) - c.length);
    assert.ok(all.length < text.length);
    const zip = await JSZip.loadAsync(all);
    assert.equal(await zip.file('books/a/chapters/1.json')!.async('string'), text);
    assert.deepEqual(await zip.file('books/a/comic/1/0.jpg')!.async('uint8array'), pic);
    assert.equal(await zip.file('settings.json')!.async('string'), '{}');
  });

  await test('reading statistics', () => {
    assert.equal(countWords(['Chu Yang didn’t move.', 'Bir, iki — üç! 3.000 adım']), 9);
    let st = recordRead(undefined, 4, 1000, 0.5);
    st = recordRead(st, 4, 1000, 0.2);
    assert.deepEqual(st[4], { words: 1000, read: 0.5 });
    assert.equal(wordsRead(st[4]), 500);
    st = recordRead(st, 5, 800, 0.98);
    assert.equal(wordsRead(st[5]), 800);
    assert.deepEqual(summarize(st), { wordsRead: 1300, wordsOpened: 1800, opened: 2, finished: 1 });
    assert.equal(formatCount(1234567), '1.234.567');
    assert.deepEqual(pastReading({ 1: 0.3, 3: 0.4 }, 3, { 0: { words: 1, read: 1 } }), [
      { index: 1, read: 1 },
      { index: 2, read: 1 },
      { index: 3, read: 0.4 },
    ]);
  });

  console.log(failures ? `\n${failures} test(s) failed` : '\nall tests passed');
  process.exit(failures ? 1 : 0);
})();

// ---- AI covers ------------------------------------------------------------------
{
  assert.equal(base64ImageExt('iVBORw0KGgo'), 'png');
  assert.equal(base64ImageExt('/9j/4AAQ'), 'jpg');
  assert.equal(base64ImageExt('UklGRiQ'), 'webp');
  const withScene = coverPrompt('X', 'blurb', 'A young man in white robes.');
  assert.ok(withScene.startsWith('A young man in white robes.'));
  assert.ok(/No text/.test(withScene));
  const fallback = coverPrompt('Transcending the Nine Heavens', 'Chu Yang returns to his youth.');
  assert.ok(fallback.includes('Transcending the Nine Heavens') && fallback.includes('Chu Yang'));
  assert.ok(coverRequest('T', '', 'd').includes('Blurb: d'));
  console.log('ok covers');
}

// ---- short character cards ---------------------------------------------------------
{
  const base = { name: 'Tian Bu Hui', aliases: ['Young Master Tian', 'Genç Efendi Tian'], firstChapter: 0, lastChapter: 9, seenIn: [0, 1, 2, 3, 4] };
  const notes = [0, 1, 2, 3, 4].map((chapter) => ({ chapter, text: `not ${chapter}`, en: `note ${chapter}` }));
  const c = { ...base, notes };
  assert.equal(needsProfile({ ...c, notes: notes.slice(0, 2) }, 9), false);
  assert.equal(needsProfile(c, 9), true);
  const cards = parseProfiles({ characters: [{ name: 'Tian Bu Hui', traits_tr: ['a', 'b', 'c', 'd', 'e', 'f'], traits_en: ['x'], aliases_tr: ['Genç Efendi Tian'], aliases_en: ['Young Master Tian'] }] });
  assert.equal(cards['Tian Bu Hui'].traitsTr.length, 5);
  const withCard = { ...c, profile: { ...cards['Tian Bu Hui'], upTo: 4, noteCount: 5 } };
  assert.equal(needsProfile(withCard, 9), false);
  assert.equal(profileFor(withCard, 3), undefined); // written from later chapters: not shown
  assert.deepEqual(aliasesFor(withCard, 'en', 9), ['Young Master Tian']);
  assert.deepEqual(aliasesFor(c, 'en', 9), ['Young Master Tian']);
  console.log('ok character cards');
}

// ---- webtoon look ------------------------------------------------------------------
{
  assert.ok(comicSystem([4, 6], true).includes('18 to 26'));
  assert.ok(!comicSystem([4, 6]).includes('18 to 26'));
  const pp = panelPrompt({ paragraph: 1, scene: 'Dutch-angle shot of Chu Yang.', characters: [], bubbles: [] } as any, {}, 'webtoon');
  assert.ok(pp.startsWith('modern Chinese donghua') && pp.includes('Chu Yang'));
  console.log('ok webtoon');
}
