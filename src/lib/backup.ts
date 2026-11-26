/**
 * Library backup: every file under <documents>/books plus settings.json, in
 * one zip saved to a folder the person picks (e.g. Download). Restoring
 * writes the files back; books with the same id are replaced, others kept.
 * The Gemini key lives in secure storage and is deliberately not included.
 */
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import JSZip from 'jszip';

import { refreshLibrary } from './library';
import { loadSettings } from './settings';
import { reloadWords } from './wordbook';
import { ZipWriter } from './zipCore';

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
  const words = new File(Paths.document, 'words.json');
  if (words.exists) files.push({ file: words, path: 'words.json' });
  const bookCount = books.exists ? books.list().filter((e) => e instanceof Directory).length : 0;
  if (!bookCount) throw new Error('Kitaplıkta yedeklenecek kitap yok.');

  // Written one file at a time straight into the chosen folder: the whole library never sits in memory at once.
  const name = backupFileName();
  const out = target.createFile(name, 'application/zip');
  const handle = out.open(FileMode.WriteOnly);
  const zip = new ZipWriter();
  try {
    for (let k = 0; k < files.length; k++) {
      if (k % 25 === 0) {
        const mb = (zip.size / 1024 / 1024).toFixed(1);
        onProgress({ message: `Yedekleniyor ${k}/${files.length} dosya (${mb} MB)`, value: (k / files.length) * 0.98 });
      }
      for (const chunk of zip.add(files[k].path, await files[k].file.bytes())) await handle.writeBytes(chunk);
    }
    const manifest: Manifest = { app: 'ebook', format: 1, createdAt: new Date().toISOString(), books: bookCount, files: files.length };
    for (const chunk of zip.add(MANIFEST, new TextEncoder().encode(JSON.stringify(manifest)))) await handle.writeBytes(chunk);
    onProgress({ message: 'Kaydediliyor…', value: 0.99 });
    await handle.writeBytes(zip.finish());
  } catch (e) {
    handle.close();
    try {
      out.delete();
    } catch {
      // A half-written file is left; nothing more to do.
    }
    throw e;
  }
  handle.close();
  const mb = (zip.size / 1024 / 1024).toFixed(1);
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
    (f) => (f.name.startsWith('books/') || f.name === 'settings.json' || f.name === 'words.json') && !f.name.split('/').some((s) => s === '..' || s === ''),
  );
  for (let k = 0; k < safe.length; k++) {
    if (k % 50 === 0) onProgress({ message: `Geri yükleniyor ${k}/${safe.length}`, value: 0.1 + (k / safe.length) * 0.85 });
    const parts = safe[k].name.split('/');
    const dir = parts.length > 1 ? new Directory(Paths.document, ...parts.slice(0, -1)) : new Directory(Paths.document);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    await new File(dir, parts[parts.length - 1]).write(await safe[k].async('uint8array'));
  }
  await loadSettings();
  await reloadWords();
  await refreshLibrary();
  return `${manifest.books} kitap geri yüklendi (yedek tarihi: ${new Date(manifest.createdAt).toLocaleString('tr-TR')}).`;
}
