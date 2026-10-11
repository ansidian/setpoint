// The seed's News images: invented, drawn here as tinted gradients (a lighter sky over a darker
// ground, with a soft horizon), never an outlet's photo. Each is a PNG at the size Setpoint keeps its
// copies, so the page draws them as it will draw real ones.
import {crc32, deflateSync} from 'node:zlib';
import {IMAGE_SIZES} from '../domain/news.ts';

/** The large copy (a block's lead, the pane, the article) and the row thumbnail, at twice their drawn size. */
export const LARGE_SIZE = IMAGE_SIZES.large;
export const THUMB_SIZE = IMAGE_SIZES.thumb;

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** HSL (hue in degrees, saturation and lightness 0–1) as 8-bit RGB. */
function rgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const k = (n: number) => (n + hue / 30) % 12;
  const a = saturation * Math.min(lightness, 1 - lightness);
  const f = (n: number) => lightness - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

// The seed draws the same few images in every test that seeds, so each is made once.
const cache = new Map<string, Buffer>();

/** A width × height PNG tinted by `hue`: light at the top, a soft horizon two-thirds down, darker below. */
export function tintedImage(width: number, height: number, hue: number): Buffer {
  const key = `${width}x${height}:${hue}`;
  const known = cache.get(key);
  if (known) return known;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  // 8-bit RGB, no interlace.
  header.set([8, 2, 0, 0, 0], 8);
  const stride = 1 + width * 3;
  const rows = Buffer.alloc(height * stride);
  const horizon = height * 0.66;
  for (let y = 0; y < height; y += 1) {
    const sky = y < horizon;
    const depth = sky ? y / horizon : (y - horizon) / (height - horizon);
    // Each row blends from its left colour to its right one, a little darker or lighter across.
    const tint = (hue + (sky ? 0 : 18)) % 360;
    const left = sky ? rgb(tint, 0.45, 0.78 - 0.18 * depth) : rgb(tint, 0.32, 0.42 - 0.14 * depth);
    const right = sky ? rgb(tint, 0.45, 0.72 - 0.18 * depth) : rgb(tint, 0.32, 0.46 - 0.14 * depth);
    const offset = y * stride;
    for (let x = 0; x < width; x += 1) {
      const across = x / width;
      for (let channel = 0; channel < 3; channel += 1) rows[offset + 1 + x * 3 + channel] = Math.round(left[channel]! + (right[channel]! - left[channel]!) * across);
    }
  }
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
  cache.set(key, png);
  return png;
}
