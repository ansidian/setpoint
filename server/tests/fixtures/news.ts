// News's invented fixtures (N2), each shaped like its source's real format and naming no real outlet
// or event: the files in fixtures/news/, with {{BASE}} standing for wherever the test serves them
// (a fake on 127.0.0.1, or an example domain for the parsers' tables).
import fs from 'node:fs';
import sharp from 'sharp';

const DIR = new URL('./news/', import.meta.url);

/** A fixture's text, with {{BASE}} as `base`. */
export const newsFixture = (name: string, base = 'https://news.example.com') => fs.readFileSync(new URL(name, DIR), 'utf8').replaceAll('{{BASE}}', base);

/** A JSON fixture, with {{BASE}} as `base`. */
export const newsJson = (name: string, base = 'https://api.example.org') => JSON.parse(newsFixture(name, base)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** An invented photo: a flat colour at a size, as a JPEG. */
export const photo = (width: number, height: number, format: 'jpeg' | 'png' | 'webp' = 'jpeg') =>
  sharp({create: {width, height, channels: 3, background: {r: 200, g: 120, b: 60}}})[format]().toBuffer();
