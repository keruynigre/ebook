/**
 * Sec-MS-GEC v2 token for the Edge read-aloud service, ported from edge-tts
 * 7.3.1 (edge_tts/drm.py). The service now expects "<CS64 16 hex>-<SHA 64 hex>",
 * where the SHA part is SHA-256 run from a modified starting state and CS64 is
 * a custom checksum. Verified against the Python original in tests.
 */
/* eslint-disable no-bitwise */
const INITIAL: number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];
const STATE: number[] = [
  0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a, 0x6c006f49, 0x04bd35ab, 0xfeb0a7e4, 0x03effbd2,
];
const SCHEDULE: number[] = [
  0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba, 0xa622ee8c, 0xd1dd9491, 0xc0dd25a0, 0xf9e70ab6,
  0xf0c31573, 0x7058ce4e, 0x7188e606, 0x00e5ab33, 0xd258b060, 0x72766564,
];
const K: number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const BLOCK_K: number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0xc9dc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const CS64_COEFFICIENTS: number[][] = [
  [0xe82e91b1, 0xb32700d0],
  [0x44de24c6, 0x88dff51d],
  [0x3beb65bc, 0x29514038],
  [0xc89c5933, 0xb328cbdf],
  [0x8d1ec211, 0xd405b4d5],
  [0x314ef5d5, 0x26e55f3c],
  [0xe92491b1, 0x607801c6],
  [0xf0a5b9d5, 0x82b2c1fb],
  [0x06064cf3, 0xfa51a3da],
  [0xda79fa60, 0x207cc464],
  [0xbed20560, 0x3c3c74f3],
  [0x89f9c9f8, 0xd2d14b61],
  [0x35fa38c6, 0xbb04a2c1],
  [0xcb49e3c6, 0xc5626167],
];
const ADJUSTMENT = 0xc9dc06a7;
const SIGMA0_ADJUSTMENT = 0x059c0b80;
const SIGMA1_ADJUSTMENT = 0x000b92c0;
const CS64_FACTOR = 0x82893933;
const CS64_ADJUSTMENT0 = 0xf2f90b1a;
const CS64_ADJUSTMENT1 = 0x0b1a0000;

const u = (x: number) => x >>> 0;
const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;
const rol16 = (x: number) => ((x << 16) | (x >>> 16)) >>> 0;
const mul = (a: number, b: number) => Math.imul(a, b) >>> 0;

// Python's sigma helpers mask once at the end; the low 32 bits equal plain SHA-256 sigmas.
const sigma0 = (x: number) => u(rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3));
const sigma1 = (x: number) => u(rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10));

function expand(w: number[], first = 16) {
  for (let i = first; i < 64; i++) w.push(u(sigma1(w[i - 2]) + w[i - 7] + sigma0(w[i - 15]) + w[i - 16]));
}

function rounds(state: number[], w: number[], first = 0): number[] {
  let [a, b, c, d, e, f, g, h] = state;
  const k = first === 14 ? BLOCK_K : K;
  for (let i = first; i < 64; i++) {
    const t1 = u(h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + (g ^ (e & (f ^ g))) + k[i] + w[i]);
    const t2 = u((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) | (c & (a | b))));
    h = g;
    g = f;
    f = e;
    e = u(d + t1);
    d = c;
    c = b;
    b = a;
    a = u(t1 + t2);
  }
  return [a, b, c, d, e, f, g, h];
}

const be32 = (d: Uint8Array, i: number) => u((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]);

function sha256Init(data: Uint8Array): number[] {
  const w: number[] = new Array(14).fill(0);
  w.push(u((data[0] << 16) | (data[1] << 8) | data[2]));
  w.push(be32(data, 3));
  for (let i = 16; i < 30; i++) {
    let v = SCHEDULE[i - 16];
    if (i - 2 >= 14) v += i === 16 ? u(sigma1(w[i - 2]) ^ SIGMA1_ADJUSTMENT) : sigma1(w[i - 2]);
    if (i - 7 >= 14) v += w[i - 7];
    if (i - 15 >= 14) v += i === 29 ? u(sigma0(w[i - 15]) ^ SIGMA0_ADJUSTMENT) : sigma0(w[i - 15]);
    w.push(u(v));
  }
  w.push(u(sigma1(w[28]) + w[23] + sigma0(w[15]) + w[14] + ADJUSTMENT - K[14]));
  expand(w, 31);
  const working = rounds(STATE, w, 14);
  return INITIAL.map((x, i) => u(x + working[i]));
}

export function sha256Digest(data: Uint8Array): Uint8Array {
  const length = 57 + data.length;
  const zeros = (((55 - length) % 64) + 64) % 64;
  const padded = new Uint8Array(data.length - 7 + 1 + zeros + 8);
  padded.set(data.subarray(7), 0);
  padded[data.length - 7] = 0x80;
  const bits = length * 8;
  const end = padded.length;
  padded[end - 4] = (bits >>> 24) & 255;
  padded[end - 3] = (bits >>> 16) & 255;
  padded[end - 2] = (bits >>> 8) & 255;
  padded[end - 1] = bits & 255;
  padded[end - 5] = Math.floor(bits / 2 ** 32) & 255;
  let state = sha256Init(data);
  for (let off = 0; off < padded.length; off += 64) {
    const w: number[] = [];
    for (let i = 0; i < 16; i++) w.push(be32(padded, off + i * 4));
    expand(w);
    const working = rounds(state, w);
    state = state.map((x, i) => u(x + working[i]));
  }
  const out = new Uint8Array(32);
  state.forEach((x, i) => {
    out[i * 4] = x >>> 24;
    out[i * 4 + 1] = (x >>> 16) & 255;
    out[i * 4 + 2] = (x >>> 8) & 255;
    out[i * 4 + 3] = x & 255;
  });
  return out;
}

const le32 = (d: Uint8Array, i: number) => u(d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24));

export function cs64Digest(data: Uint8Array, digest: Uint8Array): [number, number] {
  const keyA = u(le32(digest, 0) | 1);
  const keyB = u(le32(digest, 4) | 1);
  const factors = [mul(keyA, CS64_FACTOR), mul(keyB, CS64_FACTOR)];
  const terms = CS64_COEFFICIENTS.map(([coef], i) => mul(coef, factors[i % 2]));
  const offsets = CS64_COEFFICIENTS.map(([, off]) => off);
  // Words of "\0" + data, little-endian, zero-padded to an even number of words.
  const raw = new Uint8Array(1 + data.length);
  raw.set(data, 1);
  const n = Math.ceil(raw.length / 4);
  const bytes = new Uint8Array((n % 2 ? n + 1 : n) * 4);
  bytes.set(raw);
  for (let i = 0; i < bytes.length / 4; i++) {
    const word = le32(bytes, i * 4);
    let term = mul(word, i % 2 === 0 ? keyA : keyB);
    let offset = mul(rol16(word), i % 2 === 0 ? 0xef0569fb : 0xc31713db);
    if (i === 0) {
      term = u(term + mul(CS64_ADJUSTMENT0, factors[0]));
      offset = u(offset + CS64_ADJUSTMENT1);
    }
    terms.push(term);
    offsets.push(offset);
  }
  let swapAcc = 0;
  let swapLast = 0;
  let state = 0;
  let acc = 0;
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i];
    const y = terms[i + 1];
    let t = rol16(u(offsets[i] + x));
    let q = mul(t, 0x76f50f34);
    swapAcc = u(swapAcc + u(mul(rol16(q), 0xc3efea97) + q));
    t = rol16(u(offsets[i + 1] + y));
    q = mul(t, 0x1881ce3c);
    swapLast = u(mul(rol16(q), 0x35bd1ec9) + q);
    swapAcc = u(swapAcc + swapLast);

    state = u(mul(state, keyA) + x);
    state = mul(rol16(state), 0xcf98b111);
    state = mul(rol16(state), 0x87085b9f);
    state = mul(rol16(state), 0x12ceb96d);
    state = mul(rol16(state), 0x257e1d83);
    acc = u(acc + state);
    t = u(mul(state, keyB) + y);
    t = mul(rol16(t), 0xa27416f5);
    t = mul(rol16(t), 0xd38396ff);
    state = mul(rol16(mul(rol16(t), 0x7c932b89)), 0xbfa49f69);
    acc = u(acc + state);
  }
  return [u(swapLast ^ state), u(swapAcc ^ acc)];
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();

/** "<CS64>-<SHA256>" for the string the token hashes (see secMsGecInput). */
export function secMsGecV2(input: string): string {
  const data = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) data[i] = input.charCodeAt(i) & 255;
  const digest = sha256Digest(data);
  const [a, b] = cs64Digest(data, digest);
  const cs = new Uint8Array(8);
  [a, b].forEach((x, i) => {
    cs[i * 4] = x & 255;
    cs[i * 4 + 1] = (x >>> 8) & 255;
    cs[i * 4 + 2] = (x >>> 16) & 255;
    cs[i * 4 + 3] = x >>> 24;
  });
  return `${hex(cs)}-${hex(digest)}`;
}
