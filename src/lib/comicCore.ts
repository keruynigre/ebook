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
  /** Paragraph (0-based) the picture is shown under in the reader; missing in scripts made for the old comic screen. */
  para?: number;
}

export interface ComicScript {
  chapter: number;
  panels: ComicPanel[];
}

/** Name → fixed English look, kept for the whole book so characters stay the same from panel to panel. */
export type ComicCast = Record<string, string>;

/** How pictures are drawn: false = black and white, true = colour, 'webtoon' = modern colour manhua with dynamic camera. */
export type ArtMode = boolean | 'webtoon';

const WEBTOON_STYLE =
  '2d cultivation manhua art, crisp variable-weight black ink lineart, clean cel shading, sharp shadow planes, strong rim lighting, high contrast, full color, no text, no speech bubbles';

/** Wuxia manhua look: black-and-white ink with screentones, full colour, or modern webtoon. */
export function comicStyle(color: ArtMode): string {
  if (color === 'webtoon') return WEBTOON_STYLE;
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
export function parseComicScript(chapter: number, data: any, paragraphs = 0): { script: ComicScript; cast: ComicCast } {
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
    const panel: ComicPanel = { scene, characters, bubbles: bubbles.slice(0, 4) };
    const para = typeof p?.paragraph === 'number' ? Math.round(p.paragraph) : NaN;
    if (Number.isFinite(para)) panel.para = Math.max(0, paragraphs ? Math.min(paragraphs - 1, para) : para);
    panels.push(panel);
  }
  // Pictures in reading order.
  if (panels.every((x) => x.para !== undefined)) panels.sort((a, b) => a.para! - b.para!);
  return { script: { chapter, panels: panels.slice(0, 20) }, cast };
}

/**
 * Where each picture goes in the text: paragraph index → panel indexes shown under it.
 * Older scripts without paragraph numbers are spread evenly over the chapter.
 */
export function panelSlots(script: ComicScript, paragraphs: number): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const n = script.panels.length;
  if (!n || paragraphs <= 0) return out;
  script.panels.forEach((p, k) => {
    const at = p.para !== undefined ? Math.min(paragraphs - 1, p.para) : Math.min(paragraphs - 1, Math.floor(((k + 1) * paragraphs) / (n + 1)));
    out.set(at, [...(out.get(at) ?? []), k]);
  });
  return out;
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
export function cardPrompt(name: string, look: string, color: ArtMode = false, styleRef = false): string {
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
export function panelPrompt(panel: ComicPanel, cast: ComicCast, color: ArtMode = false, refs: PromptRefs = {}): string {
  const STYLE = comicStyle(color);
  const people = panel.characters
    .map((n) => {
      const look = lookOf(cast, n);
      return look ? `${n}: ${look}` : '';
    })
    .filter(Boolean);
  const ref = refText(refs);
  if (color === 'webtoon') return [ref, STYLE, panel.scene].filter(Boolean).join(', ').slice(0, MAX_PROMPT);
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

export type ComicQuality = 'high' | 'balanced' | 'saver';

/**
 * Drawing presets. Cloudflare bills FLUX.2 [klein] per 512×512 tile (26 neurons per
 * output tile, 5.4 per input tile), so smaller panels and fewer references cost less.
 */
export const COMIC_QUALITY: Record<ComicQuality, { width: number; height: number; refs: number; panels: [number, number] }> = {
  high: { width: 1024, height: 768, refs: 4, panels: [6, 8] },
  balanced: { width: 768, height: 576, refs: 3, panels: [4, 6] },
  saver: { width: 640, height: 480, refs: 2, panels: [3, 4] },
};

/** Pictures per chapter the user can choose; 0 means "as the quality preset suggests". */
export const COMIC_COUNTS = [0, 2, 3, 4, 5, 6, 8, 10, 12];

/** (min, max) pictures per chapter: the chosen count, or the preset's range when `count` is 0. */
export function panelRange(q: ComicQuality, count = 0): [number, number] {
  if (count > 0) return [Math.round(count), Math.round(count)];
  return COMIC_QUALITY[q].panels;
}

/** Rough neurons for one chapter (panels only; character cards come on top, once per character). */
export function chapterCost(q: ComicQuality, count = 0): number {
  const c = COMIC_QUALITY[q];
  const tiles = (c.width * c.height) / (512 * 512);
  const perPanel = tiles * 26.05 + c.refs * 0.88 * 5.37;
  const [min, max] = panelRange(q, count);
  return Math.round(perPanel * ((min + max) / 2));
}

/** The script instructions, asking for `panels` (min, max) pictures. */
export const comicSystem = (panels: [number, number] = [4, 6], webtoon = false) =>
  COMIC_SYSTEM.replace(
    '4 to 6 pictures',
    panels[0] === panels[1] ? `exactly ${panels[0]} pictures` : `${panels[0]} to ${panels[1]} pictures`,
  ) + (webtoon ? WEBTOON_CAMERA : '');

/** Extra camera direction for the modern webtoon look (tall frames, dynamic angles). */
export const WEBTOON_CAMERA = `

STYLE OF THIS BOOK: modern Chinese manhua / Korean webtoon, drawn by a lightweight image model. The following rules REPLACE the "scene" rules above. Pictures are tall vertical frames.
"scene" is NOT a paragraph: write 18 to 26 short comma-separated visual chunks, in this order:
[camera & framing], [character lock & pose], [facial expression], [environment & lighting], [single dominant effect]
Do not add the art style; it is added automatically.
1. Camera & framing, pick ONE:
- authority / dominance / menace: "low-angle shot, imposing silhouette, dramatic shadow"
- shock / fear / betrayal: "extreme close-up on eyes, constricted pupils, sweat drop, tense brow"
- combat / clash: "tilted dutch angle, dynamic mid-air clash, radial speed lines"
- dialogue / reaction: "medium shot, foreground blurred shoulder framing, clear emotional focus"
- setting / arrival / atmosphere: "wide establishing shot, grand traditional xianxia architecture" or "night sky with glowing full moon"
- comedy / gag break: "super deformed chibi style, dark purple background, comical sweat drop"
2. Acting:
- cold, calculating character: "calm cold expression, half-lidded eyes, upper face veiled in dark shadow, piercing gaze, relaxed dominant posture"
- rage / defiance: "fierce shouting expression, furrowed brows, outstretched hand" or "clenched fist"
- character lock: for every named character write short fixed tags taken from their known look: hair color, hair style/length, core outfit colors (e.g. "long black hair, white and black cultivation robes"), always the same tags for the same person.
3. ONE dominant effect only (or none in calm scenes):
- lightning / speed: "crackling cyan-blue lightning arcs"
- fire / wrath / burst: "surging orange-red flames and embers"
- dark / villain aura: "dark purple-black shadow wisps"
- impact / clash: "bright white impact flash, ground cracks"
4. Safeguards: no sentences or clauses, no words like 8k, hyper-detailed, masterpiece, photorealistic. One main action and one main effect per picture; at most 2 characters in focus, everyone else as "blurred onlookers in background".`;

export const COMIC_SYSTEM = `You are an experienced Chinese wuxia/xianxia manhua artist and storyboard director. You have illustrated many cultivation novels and know how to turn a written chapter into a few striking, cinematic pictures that make the reader feel the moment: the tension of a confrontation, the weight of a revelation, the power of a technique.
Your task: choose the moments of this chapter that get an illustration inside the text, like the pictures in an illustrated novel, and write for each one the picture description an image model (FLUX) will draw from.
The chapter is given as numbered paragraphs ("[12] ..."). Return JSON with:
- "panels": 4 to 6 pictures for the most important moments, in reading order. Prefer moments where the main character or other important characters (see the list given) speak or face each other: key dialogue, confrontations, revelations, strong emotions, fights, breakthroughs. Do not pick minor characters' small talk or transitions. Spread the pictures over the chapter and vary them (not the same shot twice in a row). For each picture:
  - "paragraph": the number of the paragraph the picture belongs under (usually the key line of dialogue or the action shown).
  - "scene": one English paragraph (40-90 words) describing ONLY what is visible at that moment, written for the image model:
    1. Start with the camera shot and the main subject: who, doing what, with which facial expression and body language (e.g. "Low-angle medium shot of Wang Lin standing on a cliff edge, eyes cold, robe whipping in the wind").
    2. Then the other characters and how they relate in space (in front of, behind, kneeling before, facing across the courtyard).
    3. Then the setting and atmosphere: place, time of day, weather, light source and mood lighting (candlelight, moonlight through mist, the glow of spiritual energy, sword light, flames).
    Choose the shot like a director: close-up for emotion and revelations, medium shot for dialogue, wide or low-angle shot for power, fights and huge scenery, over-the-shoulder for confrontations. Use concrete, visible details only; no abstract words ("a powerful feeling", "destiny"), no sounds, no thoughts, no names of techniques without saying what they look like. Do not describe the looks of named characters here beyond injuries and clothing changes (their fixed looks are added separately); never ask for written text.
  - "characters": names of the named characters visible in the picture (max 3), exactly as in the cast.
- "cast": for every named character in "panels" who is NOT in the known cast: {"name", "look"} where "look" is a fixed English visual description (gender, age, build, face, hairstyle, eyes, typical clothing, notable items), 25-45 words, based on the novel and the notes given, written so an artist could draw the same person every time. Do not repeat characters already in the known cast.
Use the same spelling of names everywhere. Answer only with the JSON.`;

export const COMIC_SCHEMA = {
  type: 'OBJECT',
  properties: {
    panels: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          paragraph: { type: 'INTEGER' },
          scene: { type: 'STRING' },
          characters: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['paragraph', 'scene', 'characters'],
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
  '\n\nAnswer format: {"panels": [{"paragraph": number, "scene": string, "characters": [string]}], "cast": [{"name": string, "look": string}]}';

/** User prompt for one chapter. */
export function comicRequest(
  bookTitle: string,
  title: string,
  paragraphs: string[],
  cast: ComicCast,
  notes: { name: string; note: string }[],
  important: string[] = [],
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

Most important characters of the story so far (main character first):
${important.join(', ') || '(unknown; judge from the chapter)'}

Notes about characters so far:
${facts || '(none)'}

Chapter paragraphs:
${paragraphs
  .map((p, k) => `[${k}] ${p}`)
  .join('\n')
  .slice(0, 60_000)}`;
}
