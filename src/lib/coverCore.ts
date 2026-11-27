/** Pure helpers for AI-drawn book covers (kept free of native modules for tests). */

export const COVER_SIZE = { width: 768, height: 1024 };

export const COVER_SYSTEM = `You are the cover art director for a Chinese web novel publisher (xianxia, wuxia, xuanhuan).
From the book's title and blurb, design ONE striking cover illustration and describe it for an image model.
Write 50-90 English words: first the camera and the main character (age, face, hair, clothes, pose, expression),
then the key symbol or creature of the story, then the setting, colours and light.
Concrete visual details only, no abstract words, no story summary. Never ask for text, letters, titles or logos.`;

export const COVER_SCHEMA = {
  type: 'OBJECT',
  properties: { prompt: { type: 'STRING' } },
  required: ['prompt'],
};

export const COVER_HINT = '\n\nAnswer only with JSON: {"prompt": "..."}';

const STYLE =
  'Vertical book cover illustration, full colour, detailed Chinese fantasy manhua painting, cinematic composition, dramatic lighting, high detail. No text, no letters, no title, no watermark.';

export function coverRequest(title: string, author: string, description: string): string {
  return [`Title: ${title}`, author ? `Author: ${author}` : '', `Blurb: ${description.slice(0, 1500) || '(none)'}`].filter(Boolean).join('\n');
}

/** The prompt sent to the image model; works without Gemini (scene from the title and blurb). */
export function coverPrompt(title: string, description: string, scene?: string): string {
  const s = (scene ?? '').trim();
  if (s) return `${s} ${STYLE}`;
  const about = description.replace(/\s+/g, ' ').slice(0, 400);
  return `Cover art for the Chinese fantasy novel "${title}": a lone cultivator hero in flowing robes stands heroically against an epic mystical landscape.${about ? ` Story: ${about}` : ''} ${STYLE}`;
}

/** File extension of a base64 image (JPEG, PNG or WebP). */
export function base64ImageExt(b64: string): string {
  if (b64.startsWith('iVBOR')) return 'png';
  if (b64.startsWith('UklGR')) return 'webp';
  return 'jpg';
}
