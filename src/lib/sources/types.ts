import type { ChapterContent, Http, NovelInfo } from '../types';

export interface ProgressInfo {
  message: string;
}

export interface NovelSource {
  id: string;
  name: string;
  /** Whether this source knows how to read the given address. */
  matches(url: URL): boolean;
  getNovel(url: string, http: Http, onProgress?: (p: ProgressInfo) => void): Promise<NovelInfo>;
  getChapter(url: string, http: Http): Promise<ChapterContent>;
}
