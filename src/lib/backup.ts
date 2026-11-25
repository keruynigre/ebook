/**
 * Library backup: every file under <documents>/books plus settings.json, in
 * one zip saved to a folder the person picks (e.g. Download). Restoring
 * writes the files back; books with the same id are replaced, others kept.
 * The Gemini key lives in secure storage and is deliberately not included.
 */
import { Directory, File, Paths } from 'expo-file-system';
import JSZip from 'jszip';

import { refreshLibrary } from './library';
import { loadSettings } from './settings';

const MANIFEST = 'ebook-backup.json';

export interface BackupProgress {
  message: string;
  /** 0–1 when known. */
  value?: number;
}

interface Manifest {
  app: 'ebook';
  format: 1;
  createdAt: string;
  books: number;
  files: number;
}

function collect(dir: Directory, prefix: string, out: { file: File; path: string }[]) {
  for (const entry of dir.list()) {
    if (entry instanceof Directory) collect(entry, `${prefix}${entry.name}/`, out);
    else out.push({ file: entry, path: `${prefix}${entry.name}` });
  }
}

export function backupFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `ebook-yedek-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.zip`;
}

/** Build the backup and write it into a folder chosen by the person. Returns a short summary. */
export async function createBackup(onProgress: (p: BackupProgress) => void): Promise<string> {
  // Ask for the folder first, so cancelling costs nothing.
  const target = await Directory.pickDirectoryAsync();

  const files: { file: File; path: string }[] = [];
  const books = new Directory(Paths.document, 'books');
  if (books.exists) collect(books, 'books/', files);
  const settings = new File(Paths.document, 'settings.json');
  if (settings.exists) files.push({ file: settings, path: 'settings.json' });
  const bookCount = books.exists ? books.list().filter((e) => e instanceof Directory).length : 0;
  if (!bookCount) throw new Error('Kitaplıkta yedeklenecek kitap yok.');

  const zip = new JSZip();
  for (let k = 0; k < files.length; k++) {
    if (k % 50 === 0) onProgress({ message: `Dosyalar okunuyor ${k}/${files.length}`, value: (k / files.length) * 0.4 });
    zip.file(files[k].path, await files[k].file.bytes());
  }
  const manifest: Manifest = { app: 'ebook', format: 1, createdAt: new Date().toISOString(), books: bookCount, files: files.length };
  zip.file(MANIFEST, JSON.stringify(manifest));

  let last = 0;
  const data = await zip.generateAsync(
    { type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    (meta) => {
      if (meta.percent - last >= 2) {
        last = meta.percent;
        onProgress({ message: `Sıkıştırılıyor %${Math.round(meta.percent)}`, value: 0.4 + (meta.percent / 100) * 0.5 });
      }
    },
  );
  onProgress({ message: 'Kaydediliyor…', value: 0.95 });
  const name = backupFileName();
  const out = target.createFile(name, 'application/zip');
  await out.write(data);
  const mb = (data.length / 1024 / 1024).toFixed(1);
  return `${bookCount} kitap yedeklendi (${mb} MB): ${target.name || 'seçilen klasör'}/${name}`;
}

/** Pick a backup zip and restore it. Returns a short summary. */
export async function restoreBackup(onProgress: (p: BackupProgress) => void): Promise<string | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'] });
  if (picked.canceled || !picked.result) return null;
  onProgress({ message: 'Yedek okunuyor…', value: 0.05 });
  const zip = await JSZip.loadAsync(await picked.result.bytes());
  const manifestFile = zip.file(MANIFEST);
  if (!manifestFile) throw new Error('Bu dosya bir Ebook yedeği değil.');
  const manifest = JSON.parse(await manifestFile.async('string')) as Manifest;
  if (manifest.app !== 'ebook') throw new Error('Bu dosya bir Ebook yedeği değil.');

  const entries = Object.values(zip.files).filter((f) => !f.dir && f.name !== MANIFEST);
  // Only our own folders: never write outside books/ or over anything but settings.json.
  const safe = entries.filter(
    (f) => (f.name.startsWith('books/') || f.name === 'settings.json') && !f.name.split('/').some((s) => s === '..' || s === ''),
  );
  for (let k = 0; k < safe.length; k++) {
    if (k % 50 === 0) onProgress({ message: `Geri yükleniyor ${k}/${safe.length}`, value: 0.1 + (k / safe.length) * 0.85 });
    const parts = safe[k].name.split('/');
    const dir = parts.length > 1 ? new Directory(Paths.document, ...parts.slice(0, -1)) : new Directory(Paths.document);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    await new File(dir, parts[parts.length - 1]).write(await safe[k].async('uint8array'));
  }
  await loadSettings();
  await refreshLibrary();
  return `${manifest.books} kitap geri yüklendi (yedek tarihi: ${new Date(manifest.createdAt).toLocaleString('tr-TR')}).`;
}
