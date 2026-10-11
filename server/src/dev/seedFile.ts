// `npm run seed`'s work: the brief's sample into a database file (and News's images beside it),
// refusing one that isn't empty unless asked to start over; with a snapshot's directory, real news
// in place of the sample's (src/dev/newsSnapshot.ts).
import fs from 'node:fs';
import path from 'node:path';
import {openDatabase} from '../db/open.ts';
import {newsImagesDir} from '../news/images.ts';
import {seedSampleData} from './sample.ts';

export function seedFile(file: string, {reset = false, newsSnapshot = null}: {reset?: boolean; newsSnapshot?: string | null} = {}) {
  const images = newsImagesDir(path.dirname(file));
  if (reset) {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${file}${suffix}`, {force: true});
    fs.rmSync(images, {recursive: true, force: true});
  }
  const {sqlite, db} = openDatabase(file);
  try {
    return seedSampleData({sqlite, db}, {newsImagesDir: images, usage: true, newsSnapshot});
  } finally {
    sqlite.close();
  }
}
