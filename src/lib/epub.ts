import JSZip from 'jszip';

import { escapeXml } from './text';
import type { ChapterContent } from './types';

export interface EpubMeta {
  /** Stable identifier; the same book keeps the same id across exports. */
  id: string;
  title: string;
  author?: string;
  description?: string;
  language?: string;
  sourceUrl?: string;
}

export interface EpubCover {
  bytes: Uint8Array;
  mediaType: string;
  ext: string;
}

export function detectImageType(bytes: Uint8Array): { mediaType: string; ext: string } | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { mediaType: 'image/jpeg', ext: 'jpg' };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return { mediaType: 'image/png', ext: 'png' };
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return { mediaType: 'image/gif', ext: 'gif' };
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  )
    return { mediaType: 'image/webp', ext: 'webp' };
  return null;
}

/** Deterministic UUID-shaped string from any text, so re-exports keep the same identifier. */
function uuidFrom(text: string): string {
  const hex: string[] = [];
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i) + round;
      h1 = Math.imul(h1 ^ c, 0x01000193);
      h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    }
    hex.push(((h1 ^ h2) >>> 0).toString(16).padStart(8, '0'));
  }
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

const CSS = `body { margin: 0 4%; line-height: 1.55; font-family: serif; }
h1, h2 { font-family: sans-serif; line-height: 1.25; text-align: center; }
h1 { margin: 2em 0 0.5em; }
h2 { margin: 1.5em 0 1em; font-size: 1.3em; }
p { margin: 0 0 0.8em; text-indent: 0; text-align: justify; }
p.sep { text-align: center; }
.author { text-align: center; font-style: italic; margin-bottom: 2em; }
.small { font-size: 0.8em; color: #666; text-align: center; margin-top: 3em; }
.cover { margin: 0; padding: 0; text-align: center; }
.cover img { max-width: 100%; max-height: 100%; }
aside.notes { margin-top: 2em; padding-top: 0.5em; border-top: 1px solid #999; font-size: 0.85em; }
p.notes-title { font-weight: bold; }
`;

function xhtml(title: string, lang: string, body: string, extraHead = ''): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(lang)}" xml:lang="${escapeXml(lang)}">
<head>
<meta charset="utf-8"/>
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="../style.css"/>${extraHead}
</head>
<body>
${body}
</body>
</html>
`;
}

function paragraphHtml(p: string): string {
  if (/^[*\s~=\-–—•·]{3,}$/.test(p)) return '<p class="sep">* * *</p>';
  return `<p>${escapeXml(p)}</p>`;
}

function notesHtml(notes?: string[]): string {
  if (!notes?.length) return '';
  return `<aside class="notes"><p class="notes-title">Çevirmen notları</p>\n${notes.map((n) => `<p>${escapeXml(n)}</p>`).join('\n')}\n</aside>\n`;
}

export interface BuildEpubOptions {
  meta: EpubMeta;
  chapters: ChapterContent[];
  cover?: EpubCover | null;
  /** Only used for the title page, e.g. "Bölüm 1–50". */
  rangeLabel?: string;
}

export async function buildEpub({ meta, chapters, cover, rangeLabel }: BuildEpubOptions): Promise<Uint8Array> {
  if (chapters.length === 0) throw new Error('EPUB için en az bir bölüm gerekli.');
  const lang = meta.language || 'en';
  const uid = `urn:uuid:${uuidFrom(meta.id)}`;
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const zip = new JSZip();

  // The mimetype entry must come first and be stored uncompressed.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`,
  );
  zip.file('OEBPS/style.css', CSS);

  const manifest: string[] = [
    '<item id="css" href="style.css" media-type="text/css"/>',
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
  ];
  const spine: string[] = [];

  if (cover) {
    const href = `images/cover.${cover.ext}`;
    zip.file(`OEBPS/${href}`, cover.bytes);
    manifest.push(`<item id="cover-image" href="${href}" media-type="${cover.mediaType}" properties="cover-image"/>`);
    zip.file(
      'OEBPS/text/cover.xhtml',
      xhtml(meta.title, lang, `<div class="cover"><img src="../${href}" alt="${escapeXml(meta.title)}"/></div>`),
    );
    manifest.push('<item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml"/>');
    spine.push('<itemref idref="cover" linear="yes"/>');
  }

  const descHtml = (meta.description ?? '')
    .split(/\n+/)
    .filter((s) => s.trim())
    .map(paragraphHtml)
    .join('\n');
  zip.file(
    'OEBPS/text/title.xhtml',
    xhtml(
      meta.title,
      lang,
      `<h1>${escapeXml(meta.title)}</h1>
${meta.author ? `<p class="author">${escapeXml(meta.author)}</p>` : ''}
${rangeLabel ? `<p class="author">${escapeXml(rangeLabel)}</p>` : ''}
${descHtml}
${meta.sourceUrl ? `<p class="small">Kaynak: ${escapeXml(meta.sourceUrl)}</p>` : ''}`,
    ),
  );
  manifest.push('<item id="titlepage" href="text/title.xhtml" media-type="application/xhtml+xml"/>');
  spine.push('<itemref idref="titlepage"/>');

  const tocItems: { href: string; title: string }[] = [];
  chapters.forEach((ch, i) => {
    const id = `ch${String(i + 1).padStart(4, '0')}`;
    const href = `text/${id}.xhtml`;
    const title = ch.title || `Bölüm ${i + 1}`;
    zip.file(
      `OEBPS/${href}`,
      xhtml(
        title,
        lang,
        `<section epub:type="chapter">\n<h2>${escapeXml(title)}</h2>\n${ch.paragraphs.map(paragraphHtml).join('\n')}\n${notesHtml(ch.notes)}</section>`,
      ),
    );
    manifest.push(`<item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
    tocItems.push({ href, title });
  });

  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(lang)}" xml:lang="${escapeXml(lang)}">
<head><meta charset="utf-8"/><title>İçindekiler</title></head>
<body>
<nav epub:type="toc" id="toc">
<h1>İçindekiler</h1>
<ol>
${tocItems.map((t) => `<li><a href="${t.href}">${escapeXml(t.title)}</a></li>`).join('\n')}
</ol>
</nav>
</body>
</html>
`,
  );

  zip.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head>
<meta name="dtb:uid" content="${uid}"/>
<meta name="dtb:depth" content="1"/>
<meta name="dtb:totalPageCount" content="0"/>
<meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle><text>${escapeXml(meta.title)}</text></docTitle>
<navMap>
${tocItems
  .map(
    (t, i) =>
      `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${escapeXml(t.title)}</text></navLabel><content src="${t.href}"/></navPoint>`,
  )
  .join('\n')}
</navMap>
</ncx>
`,
  );

  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${escapeXml(lang)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${uid}</dc:identifier>
<dc:title>${escapeXml(meta.title)}</dc:title>
${meta.author ? `<dc:creator>${escapeXml(meta.author)}</dc:creator>` : ''}
<dc:language>${escapeXml(lang)}</dc:language>
${meta.description ? `<dc:description>${escapeXml(meta.description)}</dc:description>` : ''}
${meta.sourceUrl ? `<dc:source>${escapeXml(meta.sourceUrl)}</dc:source>` : ''}
<meta property="dcterms:modified">${modified}</meta>
${cover ? '<meta name="cover" content="cover-image"/>' : ''}
</metadata>
<manifest>
${manifest.join('\n')}
</manifest>
<spine toc="ncx">
${spine.join('\n')}
</spine>
</package>
`,
  );

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    mimeType: 'application/epub+zip',
  });
}
