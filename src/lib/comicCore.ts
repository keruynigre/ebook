/** Comic ("resimli") script data and prompt building (no React Native imports, so it can be tested). */

export type BubbleKind = 'speech' | 'thought' | 'narration';

export interface ComicBubble {
  kind: BubbleKind;
  /** Who speaks or thinks; empty for narration. */
  speaker: string;
  tr: string;
  en: string;
}

export interface ComicPanel {
  /** What the picture shows, in English, for the image model. */
  scene: string;
  /** Characters visible in the picture (names as in the cast). */
  characters: string[];
  bubbles: ComicBubble[];
}

export interface ComicScript {
  chapter: number;
  panels: ComicPanel[];
}

/** Name → fixed English look, kept for the whole book so characters stay the same from panel to panel. */
export type ComicCast = Record<string, string>;

/** Wuxia manhua look: black-and-white ink with screentones, or full colour. */
export function comicStyle(color: boolean): string {
  return color
    ? 'full color Chinese wuxia manhua illustration, clean ink line art, vibrant cel shading, rich colors, cinematic composition, ancient Chinese setting'
    : 'black and white manga illustration, Chinese wuxia manhua, detailed ink line art, screentone shading, high contrast, cinematic composition, ancient Chinese setting, monochrome, no color';
}
/** @deprecated kept for tests; same as comicStyle(false). */
export const COMIC_STYLE = comicStyle(false);

const NO_TEXT = 'no text, no letters, no speech bubbles, no captions, no watermark';
const MAX_PROMPT = 1900;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Parse Gemini's answer; drops empty panels and fills in missing language with the other one. */
export function parseComicScript(chapter: number, data: any): { script: ComicScript; cast: ComicCast } {
  const cast: ComicCast = {};
  for (const c of Array.isArray(data?.cast) ? data.cast : []) {
    const name = str(c?.name);
    const look = str(c?.look);
    if (name && look && name.length <= 60) cast[name] = look;
  }
  const panels: ComicPanel[] = [];
  for (const p of Array.isArray(data?.panels) ? data.panels : []) {
    const scene = str(p?.scene);
    if (!scene) continue;
    const characters = (Array.isArray(p?.characters) ? p.characters : []).map(str).filter(Boolean).slice(0, 4);
    const bubbles: ComicBubble[] = [];
    for (const b of Array.isArray(p?.bubbles) ? p.bubbles : []) {
      const tr = str(b?.tr);
      const en = str(b?.en);
      if (!tr && !en) continue;
      const kind: BubbleKind = b?.kind === 'thought' || b?.kind === 'narration' ? b.kind : 'speech';
      bubbles.push({ kind, speaker: kind === 'narration' ? '' : str(b?.speaker), tr: tr || en, en: en || tr });
    }
    panels.push({ scene, characters, bubbles: bubbles.slice(0, 4) });
  }
  return { script: { chapter, panels: panels.slice(0, 20) }, cast };
}

/** Known looks win: a character keeps the look first given to them. */
export function mergeCast(known: ComicCast, found: ComicCast): ComicCast {
  const out = { ...known };
  const lower = new Set(Object.keys(known).map((k) => k.toLowerCase()));
  for (const [name, look] of Object.entries(found)) if (!lower.has(name.toLowerCase())) out[name] = look;
  return out;
}

const lookOf = (cast: ComicCast, name: string) => {
  const n = name.toLowerCase();
  const key = Object.keys(cast).find((k) => k.toLowerCase() === n) ?? Object.keys(cast).find((k) => k.toLowerCase().includes(n) || n.includes(k.toLowerCase()));
  return key ? cast[key] : '';
};

export interface PromptRefs {
  /** Input image 0 is the user's art style picture. */
  style?: boolean;
  /** Character reference cards in input-image order (after the style picture). */
  cards?: string[];
}

/** How the reference pictures are meant to be used, for the image model. */
function refText(refs: PromptRefs): string {
  const out: string[] = [];
  let k = 0;
  if (refs.style) out.push(`Draw in the art style of image ${k++} (style reference only, not its content)`);
  for (const name of refs.cards ?? []) out.push(`image ${k++} is ${name}: keep exactly the same face, hairstyle and clothing`);
  return out.join('. ');
}

/** Names of a panel's characters that have a look in the cast (the ones worth a reference card). */
export function castNames(panel: ComicPanel, cast: ComicCast): string[] {
  const out: string[] = [];
  for (const n of panel.characters) {
    const n2 = n.toLowerCase();
    const key = Object.keys(cast).find((k) => k.toLowerCase() === n2) ?? Object.keys(cast).find((k) => k.toLowerCase().includes(n2) || n2.includes(k.toLowerCase()));
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

/** Prompt for a character's reference card (portrait on a plain background). */
export function cardPrompt(name: string, look: string, color = false, styleRef = false): string {
  return [
    styleRef ? 'Draw in the art style of image 0 (style reference only)' : '',
    comicStyle(color),
    `character reference portrait of ${name}: ${look}`,
    'upper body, facing the viewer, clear face, plain white background',
    NO_TEXT,
  ]
    .filter(Boolean)
    .join('. ')
    .slice(0, MAX_PROMPT);
}

/** Text prompt for one panel picture. */
export function panelPrompt(panel: ComicPanel, cast: ComicCast, color = false, refs: PromptRefs = {}): string {
  const STYLE = comicStyle(color);
  const people = panel.characters
    .map((n) => {
      const look = lookOf(cast, n);
      return look ? `${n}: ${look}` : '';
    })
    .filter(Boolean);
  const ref = refText(refs);
  const parts = [ref, STYLE, panel.scene, people.length ? `Characters: ${people.join('; ')}` : '', NO_TEXT].filter(Boolean);
  let prompt = parts.join('. ');
  if (prompt.length > MAX_PROMPT) {
    const head = `${ref ? `${ref}. ` : ''}${STYLE}. ${panel.scene}`.slice(0, MAX_PROMPT - NO_TEXT.length - 4);
    const room = MAX_PROMPT - head.length - NO_TEXT.length - 4;
    const ppl = people.length && room > 40 ? `. Characters: ${people.join('; ')}`.slice(0, room) : '';
    prompt = `${head}${ppl}. ${NO_TEXT}`;
  }
  return prompt;
}

export const COMIC_SYSTEM = `You turn a chapter of a Chinese wuxia/xianxia web novel into a black-and-white comic (webtoon) script.
Return JSON with:
- "panels": 12 to 15 panels that tell the chapter's main events in order. For each panel:
  - "scene": one English paragraph describing ONLY what is visible: setting, camera shot (close-up, wide shot, low angle…), characters' poses, actions and expressions, lighting. Do not describe looks of named characters here beyond clothing changes; never ask for written text.
  - "characters": names of the named characters visible in the panel (max 3), exactly as in the cast.
  - "bubbles": 0 to 3 lines from the chapter for this moment: {"kind": "speech" | "thought" | "narration", "speaker": name (empty for narration), "tr": Turkish, "en": English}. Keep each line short (max ~20 words); use the novel's own dialogue where possible.
- "cast": for every named character in "panels" who is NOT in the known cast: {"name", "look"} where "look" is a fixed English visual description (gender, age, build, face, hairstyle, eyes, typical clothing, notable items), 25-45 words, based on the novel and the notes given. Do not repeat characters already in the known cast.
Use the same spelling of names everywhere. Answer only with the JSON.`;

export const COMIC_SCHEMA = {
  type: 'OBJECT',
  properties: {
    panels: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          scene: { type: 'STRING' },
          characters: { type: 'ARRAY', items: { type: 'STRING' } },
          bubbles: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                kind: { type: 'STRING', enum: ['speech', 'thought', 'narration'] },
                speaker: { type: 'STRING' },
                tr: { type: 'STRING' },
                en: { type: 'STRING' },
              },
              required: ['kind', 'tr', 'en'],
            },
          },
        },
        required: ['scene', 'characters', 'bubbles'],
      },
    },
    cast: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, look: { type: 'STRING' } }, required: ['name', 'look'] },
    },
  },
  required: ['panels', 'cast'],
};

export const COMIC_HINT =
  '\n\nAnswer format: {"panels": [{"scene": string, "characters": [string], "bubbles": [{"kind": "speech"|"thought"|"narration", "speaker": string, "tr": string, "en": string}]}], "cast": [{"name": string, "look": string}]}';

/** User prompt for one chapter. */
export function comicRequest(
  bookTitle: string,
  title: string,
  text: string,
  cast: ComicCast,
  notes: { name: string; note: string }[],
): string {
  const known = Object.entries(cast)
    .slice(0, 80)
    .map(([n, l]) => `- ${n}: ${l}`)
    .join('\n');
  const facts = notes
    .slice(0, 60)
    .map((x) => `- ${x.name}: ${x.note}`)
    .join('\n');
  return `Novel: ${bookTitle}
Chapter: ${title}

Known cast (keep these names; do not describe them again):
${known || '(none yet)'}

Notes about characters so far:
${facts || '(none)'}

Chapter text:
${text.slice(0, 60_000)}`;
}
