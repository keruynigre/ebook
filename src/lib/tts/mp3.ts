// Minimal MP3 frame walking, ported from the novelvoice Space (tts_engine.py).
// Edge pads every clip with about a second of silence; trimming it keeps the
// pause between paragraphs natural.

const MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

function id3End(d: Uint8Array): number {
  if (d.length >= 10 && d[0] === 0x49 && d[1] === 0x44 && d[2] === 0x33) {
    return 10 + (((d[6] & 0x7f) << 21) | ((d[7] & 0x7f) << 14) | ((d[8] & 0x7f) << 7) | (d[9] & 0x7f));
  }
  return 0;
}

/** [frame length in bytes, frame duration in seconds] or null. */
export function frameInfo(d: Uint8Array, pos: number): [number, number] | null {
  if (pos + 4 > d.length) return null;
  if (d[pos] !== 0xff || (d[pos + 1] & 0xe0) !== 0xe0) return null;
  const version = (d[pos + 1] >> 3) & 3;
  const layer = (d[pos + 1] >> 1) & 3;
  const bitrateIndex = (d[pos + 2] >> 4) & 15;
  const rateIndex = (d[pos + 2] >> 2) & 3;
  const padding = (d[pos + 2] >> 1) & 1;
  if (!SAMPLE_RATES[version] || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const sampleRate = SAMPLE_RATES[version][rateIndex];
  let len: number;
  let samples: number;
  if (version === 3) {
    len = Math.floor((144 * MPEG1_L3[bitrateIndex] * 1000) / sampleRate) + padding;
    samples = 1152;
  } else {
    len = Math.floor((72 * MPEG2_L3[bitrateIndex] * 1000) / sampleRate) + padding;
    samples = 576;
  }
  if (len <= 4) return null;
  return [len, samples / sampleRate];
}

export function mp3Duration(d: Uint8Array): number {
  let pos = id3End(d);
  let total = 0;
  while (pos + 4 <= d.length) {
    const info = frameInfo(d, pos);
    if (!info) {
      pos++;
      continue;
    }
    total += info[1];
    pos += info[0];
  }
  return total;
}

/** Drop whole frames after `keepSeconds`. */
export function trimMp3(d: Uint8Array, keepSeconds: number): Uint8Array {
  if (!d.length || keepSeconds <= 0) return d;
  let pos = id3End(d);
  let total = 0;
  let keepEnd = pos;
  while (pos + 4 <= d.length) {
    const info = frameInfo(d, pos);
    if (!info) {
      pos++;
      continue;
    }
    if (total + info[1] > keepSeconds) break;
    total += info[1];
    pos += info[0];
    keepEnd = pos;
  }
  return keepEnd > 0 ? d.subarray(0, keepEnd) : d;
}
