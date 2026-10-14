// Reads EAN-13, UPC-A (read as EAN-13 with a leading 0) and EAN-8 barcodes from a row of pixel
// brightness values. It is used when the phone has no built-in barcode reader (iPhones), so the
// app needs no extra package. Pure functions, so they can be tested on their own.

// Bar and space widths (in modules) of each digit: [space, bar, space, bar] for the left side.
const L_BITS = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];

function runsOf(bits: string): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < bits.length) {
    let j = i;
    while (j < bits.length && bits[j] === bits[i]) j++;
    out.push(j - i);
    i = j;
  }
  return out;
}

const invert = (b: string) => b.replace(/[01]/g, (c) => (c === "0" ? "1" : "0"));
const reverse = (b: string) => b.split("").reverse().join("");

// Every code as its four run widths, always starting with a space for L and G, and a bar for R.
const L_RUNS = L_BITS.map(runsOf); // starts with a space (0)
const G_RUNS = L_BITS.map((b) => runsOf(reverse(invert(b)))); // G = R reversed; starts with a space
const R_RUNS = L_BITS.map((b) => runsOf(invert(b))); // starts with a bar (1)

const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

// Best match for 4 run widths: returns the digit and how far off it was (lower is better).
function matchDigit(w: number[], table: number[][]): { digit: number; err: number } | null {
  const total = w[0] + w[1] + w[2] + w[3];
  if (total <= 0) return null;
  const scale = 7 / total;
  let best = -1;
  let bestErr = Infinity;
  for (let d = 0; d < 10; d++) {
    let err = 0;
    for (let k = 0; k < 4; k++) err += Math.abs(w[k] * scale - table[d][k]);
    if (err < bestErr) {
      bestErr = err;
      best = d;
    }
  }
  return bestErr < 1.6 ? { digit: best, err: bestErr } : null;
}

function checkOk(code: string): boolean {
  const d = code.split("").map(Number);
  const check = d.pop() as number;
  let sum = 0;
  // From the right, the digit next to the check digit is weighted 3, then 1, then 3...
  for (let i = d.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += d[i] * w;
  return (10 - (sum % 10)) % 10 === check;
}

// Dark and light stretches along the row as lengths (in pixels, fractional). Edges are placed where
// the brightness crosses the middle between the darkest and lightest parts of the row, so lighting
// and blur do not matter much.
function toRuns(row: ArrayLike<number>): { len: number[]; bar0: boolean } | null {
  const n = row.length;
  if (n < 40) return null;
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = (row[Math.max(0, i - 1)] + 2 * row[i] + row[Math.min(n - 1, i + 1)]) / 4;
  const sorted = Array.from(s).sort((a, b) => a - b);
  const lo = sorted[Math.floor(n * 0.03)];
  const hi = sorted[Math.floor(n * 0.97)];
  if (hi - lo < 40) return null; // not enough contrast to hold bars
  const mid = (lo + hi) / 2;
  const h = (hi - lo) * 0.0; // a change must pass this far beyond the middle to count
  let bar = s[0] < mid;
  const bar0 = bar;
  const edges: number[] = [0];
  for (let i = 1; i < n; i++) {
    const flip = bar ? s[i] > mid + h : s[i] < mid - h;
    if (!flip) continue;
    // Walk back to where the middle was actually crossed, and place the edge there.
    let j = i;
    while (j > 0 && (bar ? s[j - 1] > mid : s[j - 1] < mid)) j--;
    const a = s[Math.max(0, j - 1)];
    const c = s[j];
    const t = c === a ? 0 : (mid - a) / (c - a);
    edges.push(Math.max(edges[edges.length - 1], Math.max(0, j - 1) + t));
    bar = !bar;
  }
  edges.push(n);
  const len: number[] = [];
  for (let i = 1; i < edges.length; i++) len.push(edges[i] - edges[i - 1]);
  return { len, bar0 };
}

function tryDecode(len: number[], bar0: boolean): string | null {
  // A start guard is bar, space, bar of equal width. Look for it at each bar.
  for (let i = bar0 ? 0 : 1; i + 3 < len.length; i += 2) {
    const a = len[i];
    const b = len[i + 1];
    const c = len[i + 2];
    const m = (a + b + c) / 3;
    if (m < 1.2) continue;
    if (Math.abs(a - m) > m * 0.5 || Math.abs(b - m) > m * 0.5 || Math.abs(c - m) > m * 0.5) continue;
    // The quiet zone before the guard should be at least a few modules wide (or the image edge).
    if (i > 0 && len[i - 1] < m * 4) continue;
    const ean13 = readSide(len, i + 3, 6, true);
    if (ean13) {
      const mid = i + 3 + 24;
      // Middle guard: space, bar, space, bar, space, then the right side.
      const right = readSide(len, mid + 5, 6, false);
      if (right) {
        const first = PARITY.findIndex((p) => p === ean13.kinds);
        if (first >= 0) {
          const code = `${first}${ean13.digits}${right.digits}`;
          if (checkOk(code)) return code;
        }
      }
    }
    const ean8 = readSide(len, i + 3, 4, false, true);
    if (ean8) {
      const right = readSide(len, i + 3 + 16 + 5, 4, false);
      if (right) {
        const code = `${ean8.digits}${right.digits}`;
        if (checkOk(code)) return code;
      }
    }
  }
  return null;
}

// Reads `count` digits starting at run index `at`. Left-side digits may be L or G coded
// (`both`); `leftOnly` forces L (EAN-8 left half); otherwise the digits are right-side codes.
function readSide(len: number[], at: number, count: number, both: boolean, leftOnly = false): { digits: string; kinds: string } | null {
  let digits = "";
  let kinds = "";
  for (let k = 0; k < count; k++) {
    const w = len.slice(at + k * 4, at + k * 4 + 4);
    if (w.length < 4) return null;
    if (both || leftOnly) {
      const l = matchDigit(w, L_RUNS);
      const g = leftOnly ? null : matchDigit(w, G_RUNS);
      if (!l && !g) return null;
      if (l && (!g || l.err <= g.err)) {
        digits += l.digit;
        kinds += "L";
      } else if (g) {
        digits += g.digit;
        kinds += "G";
      }
    } else {
      const r = matchDigit(w, R_RUNS);
      if (!r) return null;
      digits += r.digit;
    }
  }
  return { digits, kinds };
}

// Decode one row of brightness values (0 dark to 255 light). Tries both directions, so an
// upside-down barcode works too. Returns the digits, or null.
export function decodeRow(row: ArrayLike<number>): string | null {
  const r = toRuns(row);
  if (!r) return null;
  const fwd = tryDecode(r.len, r.bar0);
  if (fwd) return fwd;
  // Reversed: the first run becomes the last.
  const lastIsBar = r.bar0 === (r.len.length % 2 === 1);
  return tryDecode([...r.len].reverse(), lastIsBar);
}

// Stretch a row to twice its length (straight lines between pixels). Narrow bars then span more
// samples, which helps when the barcode is small in the picture.
function stretch(row: ArrayLike<number>): Float32Array {
  const n = row.length;
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[2 * i] = row[i];
    out[2 * i + 1] = (row[i] + row[Math.min(n - 1, i + 1)]) / 2;
  }
  return out;
}

// Decode a camera frame (RGBA pixels) by trying many rows through the middle band, each as it is
// and stretched. Bigger frames read better: a barcode needs about 3 pixels per thinnest bar.
export function decodeFrame(rgba: Uint8ClampedArray, width: number, height: number): string | null {
  const lum = (x: number, y: number) => {
    const o = (y * width + x) * 4;
    return (rgba[o] * 77 + rgba[o + 1] * 150 + rgba[o + 2] * 29) >> 8;
  };
  const line = new Uint8Array(width);
  for (let k = 0; k < 17; k++) {
    // 50%, then outwards: 47%, 53%, 44%, 56% ... up to 26% and 74%.
    const f = 0.5 + (k === 0 ? 0 : (k % 2 === 1 ? -1 : 1) * Math.ceil(k / 2) * 0.03);
    const y = Math.min(height - 2, Math.max(1, Math.round(height * f)));
    for (let x = 0; x < width; x++) line[x] = (lum(x, y - 1) + lum(x, y) + lum(x, y + 1)) / 3;
    const code = decodeRow(line) ?? decodeRow(stretch(line));
    if (code) return code;
  }
  return null;
}

// Test helper: the bar pattern of a code as modules (1 = bar), for building images in tests.
export function encodeEan13(code: string): number[] {
  const first = Number(code[0]);
  const kinds = PARITY[first];
  let bits = "101";
  for (let i = 0; i < 6; i++) {
    const d = Number(code[i + 1]);
    bits += kinds[i] === "L" ? L_BITS[d] : reverse(invert(L_BITS[d]));
  }
  bits += "01010";
  for (let i = 0; i < 6; i++) bits += invert(L_BITS[Number(code[i + 7])]);
  bits += "101";
  return bits.split("").map(Number);
}
