import { deflateSync } from "node:zlib";

export type ScoreboardVariant =
  | "matching"
  | "mismatch_a"
  | "mismatch_b"
  | "blurry"
  | "wrong_players";

export interface ScoreboardOptions {
  homeName: string;
  awayName: string;
  homeScore: number;
  awayScore: number;
  variant?: ScoreboardVariant;
  subtitle?: string;
}

/**
 * Minimal 5x7 bitmap font for uppercase letters, digits, and punctuation so we can render
 * real uncompressed/deflated PNG scoreboard files without external native canvas binaries.
 */
const FONT_5X7: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  "-": [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  ":": [0x00, 0x04, 0x04, 0x00, 0x04, 0x04, 0x00],
  " ": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
};

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc, false);
  return out;
}

/**
 * Generates a real PNG image (480x270) of a generic football club scoreboard (`T-100`).
 * Zero third-party trademarks or logos.
 */
export function renderScoreboardPng(options: ScoreboardOptions): Uint8Array {
  const width = 480;
  const height = 270;
  const pixels = new Uint8Array(width * height * 4);

  const setPixel = (
    x: number,
    y: number,
    r: number,
    g: number,
    b: number
  ) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = (y * width + x) * 4;
    pixels[idx] = r;
    pixels[idx + 1] = g;
    pixels[idx + 2] = b;
    pixels[idx + 3] = 255;
  };

  const fillRect = (
    x0: number,
    y0: number,
    w: number,
    h: number,
    r: number,
    g: number,
    b: number
  ) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        setPixel(x, y, r, g, b);
      }
    }
  };

  const drawText = (
    text: string,
    x0: number,
    y0: number,
    scale: number,
    r: number,
    g: number,
    b: number
  ) => {
    const upper = text.toUpperCase();
    let cursorX = x0;
    for (let i = 0; i < upper.length; i++) {
      const ch = upper[i];
      const glyph = FONT_5X7[ch] ?? FONT_5X7[" "];
      for (let row = 0; row < 7; row++) {
        const bits = glyph[row];
        for (let col = 0; col < 5; col++) {
          if ((bits >> (4 - col)) & 1) {
            fillRect(
              cursorX + col * scale,
              y0 + row * scale,
              scale,
              scale,
              r,
              g,
              b
            );
          }
        }
      }
      cursorX += 6 * scale;
    }
  };

  // 1. Pitch dark background (#0F231E)
  fillRect(0, 0, width, height, 15, 35, 30);

  // 2. Inner scoreboard panel (#FFFFFF paper with #17734A pitch header)
  fillRect(24, 24, width - 48, height - 48, 242, 245, 241);
  fillRect(24, 24, width - 48, 42, 23, 115, 74);
  fillRect(24, 66, width - 48, 4, 240, 190, 31); // yellow rule

  // Header text: "SPOT KICK CLUB - FULL TIME"
  drawText(
    options.variant === "blurry"
      ? "UNREADABLE CAPTURE"
      : "SPOT KICK CLUB - FULL TIME",
    42,
    38,
    2,
    255,
    255,
    255
  );

  // Player boxes
  fillRect(44, 92, 160, 110, 255, 255, 255);
  fillRect(276, 92, 160, 110, 255, 255, 255);

  const homeLabel = options.homeName.slice(0, 24);
  const awayLabel = options.awayName.slice(0, 24);

  drawText(homeLabel, 58, 108, homeLabel.length > 10 ? 1 : 2, 15, 35, 30);
  drawText(String(options.homeScore), 108, 140, 5, 23, 115, 74);

  drawText("-", 232, 146, 3, 91, 111, 103);

  drawText(awayLabel, 290, 108, awayLabel.length > 10 ? 1 : 2, 15, 35, 30);
  drawText(String(options.awayScore), 340, 140, 5, 23, 115, 74);

  const footer =
    options.subtitle ??
    (options.variant === "blurry"
      ? "BLURRY / OBSCURED RESULT SCREEN"
      : "FINAL MATCH RESULT");
  drawText(footer, 44, 220, 2, 91, 111, 103);

  // If blurry variant, apply strong horizontal/vertical block distortion over the score area
  if (options.variant === "blurry") {
    for (let y = 85; y < 205; y += 8) {
      for (let x = 40; x < 440; x += 8) {
        const shade = ((x + y) % 32 === 0) ? 180 : 215;
        fillRect(x, y, 8, 8, shade, shade + 5, shade);
      }
    }
  }

  // Encode raw scanlines (filter byte 0 per row)
  const rawData = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    rawData[rowStart] = 0;
    rawData.set(
      pixels.subarray(y * width * 4, (y + 1) * width * 4),
      rowStart + 1
    );
  }

  const compressed = deflateSync(rawData);

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const ihdrChunk = makeChunk("IHDR", ihdr);
  const idatChunk = makeChunk("IDAT", new Uint8Array(compressed));
  const iendChunk = makeChunk("IEND", new Uint8Array(0));

  const out = new Uint8Array(
    signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length
  );
  let offset = 0;
  out.set(signature, offset);
  offset += signature.length;
  out.set(ihdrChunk, offset);
  offset += ihdrChunk.length;
  out.set(idatChunk, offset);
  offset += idatChunk.length;
  out.set(iendChunk, offset);

  return out;
}
