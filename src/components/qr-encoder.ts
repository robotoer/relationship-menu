/**
 * A small QR code encoder (ISO/IEC 18004), for "Add a device" (SY-10).
 *
 * Byte mode only (UTF-8), versions 1–40, error correction L, M, Q or H, and the
 * standard choice of mask by penalty score. That's all a pairing link needs, so
 * it stays a couple of KB instead of a library. It follows the structure of
 * Project Nayuki's QR Code generator (MIT), and its tests compare it module by
 * module with an independent encoder (`QrCode.test.tsx`).
 *
 * The input is usually secret (a pairing link holds a key in its fragment), so
 * nothing here logs it or puts it in an error message.
 */

export type QrErrorCorrection = "L" | "M" | "Q" | "H";

export type QrMatrix = {
  version: number;
  /** Modules per side, without the quiet zone. */
  size: number;
  mask: number;
  /** Row by row, 1 for dark. */
  modules: Uint8Array;
};

/** Each level's row in the tables below, and its two format bits. */
const LEVELS: Record<QrErrorCorrection, { row: number; format: number }> = {
  L: { row: 0, format: 1 },
  M: { row: 1, format: 0 },
  Q: { row: 2, format: 3 },
  H: { row: 3, format: 2 },
};

/** Error correction codewords per block, for versions 1–40; rows L, M, Q, H. */
// prettier-ignore
const ECC_PER_BLOCK = [
  [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

/** Error correction blocks, for versions 1–40; rows L, M, Q, H. */
// prettier-ignore
const BLOCKS = [
  [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

/** Modules left for data and error correction once the function patterns are drawn. */
const rawDataModules = (version: number): number => {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
};

const dataCodewords = (version: number, row: number): number =>
  (rawDataModules(version) >> 3) - ECC_PER_BLOCK[row]![version - 1]! * BLOCKS[row]![version - 1]!;

/** Centres of the alignment patterns along one axis. */
const alignmentPositions = (version: number, size: number): number[] => {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
};

/** Multiplication in GF(2^8) modulo x^8 + x^4 + x^3 + x^2 + 1. */
const gfMultiply = (x: number, y: number): number => {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
};

/** The Reed–Solomon generator polynomial of a degree, highest coefficient first (the leading 1 left out). */
const reedSolomonDivisor = (degree: number): number[] => {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j]!, root) ^ (j + 1 < degree ? result[j + 1]! : 0);
    }
    root = gfMultiply(root, 2);
  }
  return result;
};

const reedSolomonRemainder = (data: number[], divisor: number[]): number[] => {
  const result = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    divisor.forEach((coefficient, i) => (result[i]! ^= gfMultiply(coefficient, factor)));
  }
  return result;
};

/** The eight masks: whether the module at column x, row y is flipped. */
const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** The codewords for `bytes`: data in byte mode, padded, split into blocks with error correction, interleaved. */
const codewordsFor = (bytes: Uint8Array, version: number, row: number): number[] => {
  const capacity = dataCodewords(version, row) * 8;
  const bits: number[] = [];
  const put = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  bytes.forEach((byte) => put(byte, 8));
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));

  const blockCount = BLOCKS[row]![version - 1]!;
  const eccLength = ECC_PER_BLOCK[row]![version - 1]!;
  const total = rawDataModules(version) >> 3;
  const shortBlocks = blockCount - (total % blockCount);
  const shortLength = Math.floor(total / blockCount);
  const divisor = reedSolomonDivisor(eccLength);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < blockCount; i++) {
    const block = data.slice(k, (k += shortLength - eccLength + (i < shortBlocks ? 0 : 1)));
    const ecc = reedSolomonRemainder(block, divisor);
    // Short blocks get a placeholder so every block lines up; it's skipped below.
    if (i < shortBlocks) block.push(0);
    blocks.push(block.concat(ecc));
  }
  const result: number[] = [];
  for (let i = 0; i < shortLength + 1; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLength - eccLength || j >= shortBlocks) result.push(block[i]!);
    });
  }
  return result;
};

/** The penalty score of a finished symbol (lower is easier to scan). */
const penalty = (modules: Uint8Array, size: number): number => {
  let score = 0;
  // Rules 1 and 3, along rows and then columns: long runs, and finder-like 1:1:3:1:1 patterns.
  const patterns = (history: number[]): number => {
    const n = history[1]!;
    const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
    return (
      (core && history[0]! >= n * 4 && history[6]! >= n ? 1 : 0) +
      (core && history[6]! >= n * 4 && history[0]! >= n ? 1 : 0)
    );
  };
  const addRun = (length: number, history: number[]) => {
    // The quiet zone counts as light around the edges.
    history.pop();
    history.unshift(history[0] === 0 ? length + size : length);
  };
  for (const columns of [false, true]) {
    for (let a = 0; a < size; a++) {
      let color = 0;
      let run = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let b = 0; b < size; b++) {
        const module = columns ? modules[b * size + a]! : modules[a * size + b]!;
        if (module === color) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score++;
        } else {
          addRun(run, history);
          if (!color) score += patterns(history) * 40;
          color = module;
          run = 1;
        }
      }
      if (color) {
        addRun(run, history);
        run = 0;
      }
      addRun(run + size, history);
      score += patterns(history) * 40;
    }
  }
  // Rule 2: 2×2 blocks of one color.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y * size + x];
      if (c === modules[y * size + x + 1] && c === modules[(y + 1) * size + x] && c === modules[(y + 1) * size + x + 1]) score += 3;
    }
  }
  // Rule 4: how far the share of dark modules is from half.
  const dark = modules.reduce((sum, m) => sum + m, 0);
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
};

/**
 * The QR code for `text`, in the smallest version that fits at the given error
 * correction (M by default, which survives a scuffed or glary screen). `mask`
 * picks a mask instead of the best-scoring one (for tests).
 */
export const encodeQr = (
  text: string,
  { ecc = "M", mask }: { ecc?: QrErrorCorrection; mask?: number } = {}
): QrMatrix => {
  const bytes = new TextEncoder().encode(text);
  const { row, format } = LEVELS[ecc];
  let version = 1;
  while (4 + (version < 10 ? 8 : 16) + bytes.length * 8 > dataCodewords(version, row) * 8) {
    if (++version > 40) throw new RangeError("That's too long for a QR code.");
  }

  const size = version * 4 + 17;
  const modules = new Uint8Array(size * size);
  const reserved = new Uint8Array(size * size);
  const set = (x: number, y: number, dark: boolean) => {
    modules[y * size + x] = dark ? 1 : 0;
    reserved[y * size + x] = 1;
  };

  // Timing patterns, then the finder patterns (with their light separators) over them.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const ring = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, ring !== 2 && ring !== 4);
      }
    }
  }
  const align = alignmentPositions(version, size);
  const last = align.length - 1;
  align.forEach((ax, i) =>
    align.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    })
  );

  const drawFormat = (maskId: number) => {
    const data = (format << 3) | maskId;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  // Reserve the format areas now; they're drawn for real once the mask is chosen.
  drawFormat(0);

  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  // Data, in two-module columns zigzagging up and down from the bottom right, around column 6.
  const codewords = codewordsFor(bytes, version, row);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vertical = 0; vertical < size; vertical++) {
      const y = upward ? size - 1 - vertical : vertical;
      for (let j = 0; j < 2; j++) {
        const at = y * size + right - j;
        if (!reserved[at] && i < codewords.length * 8) {
          modules[at] = (codewords[i >>> 3]! >>> (7 - (i & 7))) & 1;
          i++;
        }
      }
    }
  }

  const applyMask = (maskId: number) => {
    const flip = MASKS[maskId]!;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) if (!reserved[y * size + x] && flip(x, y)) modules[y * size + x]! ^= 1;
    }
  };
  let chosen = mask ?? 0;
  if (mask === undefined) {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m);
      drawFormat(m);
      const score = penalty(modules, size);
      if (score < best) {
        best = score;
        chosen = m;
      }
      applyMask(m);
    }
  } else if (!Number.isInteger(mask) || mask < 0 || mask > 7) {
    throw new RangeError("A QR mask is 0 to 7.");
  }
  applyMask(chosen);
  drawFormat(chosen);
  return { version, size, mask: chosen, modules };
};
