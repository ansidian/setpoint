// Setpoint's own copies of News images (DESIGN.md › The list: Thumbnails): each a file in the data
// directory's news-images/, recorded in `news_images` with its size, and served from
// /api/news/images/:id so outlets never see the user's browsing and blocking hotlinks can't break it.
// N2 fetches and resizes; this keeps the copies, and the expiry deletes them with their story (the
// archive keeps the story's thumbnail).
import fs from 'node:fs';
import path from 'node:path';
import {and, eq} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import type {ImageVariant} from '../domain/news.ts';
import {isoNow, transaction} from '../store.ts';
import type {Store} from '../store.ts';

export const NEWS_IMAGES_DIR = 'news-images';
export const newsImagesDir = (dataDir: string) => path.join(dataDir, NEWS_IMAGES_DIR);

const EXTENSIONS = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'} as const;
export type NewsImageType = keyof typeof EXTENSIONS;

export interface ImageCopy {
  bytes: Buffer;
  mimeType: NewsImageType;
  width: number;
  height: number;
}

/**
 * Keeps an article's copy of one variant, replacing the one it had under a new id (so a browser never
 * keeps the old one under the same URL). The file is written before the row, so a row always has its
 * file; a file left by a crash between them is overwritten next time. `dir` null records the row
 * alone (a database with no data directory: the tests' in-memory ones).
 */
export function saveNewsImage(store: Store, dir: string | null, articleId: number, variant: ImageVariant, copy: ImageCopy) {
  const file = `${articleId}-${variant}.${EXTENSIONS[copy.mimeType]}`;
  if (dir) {
    fs.mkdirSync(dir, {recursive: true});
    const temporary = path.join(dir, `.${file}.${process.pid}`);
    fs.writeFileSync(temporary, copy.bytes);
    fs.renameSync(temporary, path.join(dir, file));
  }
  const values = {articleId, variant, file, mimeType: copy.mimeType, width: copy.width, height: copy.height, sizeBytes: copy.bytes.length, createdAt: isoNow(store)};
  const replaced = transaction(store, () => {
    const before = store.db.select().from(t.newsImages).where(and(eq(t.newsImages.articleId, articleId), eq(t.newsImages.variant, variant))).get();
    if (before) store.db.delete(t.newsImages).where(eq(t.newsImages.id, before.id)).run();
    store.db.insert(t.newsImages).values(values).run();
    return before && before.file !== file ? before.file : null;
  });
  if (replaced) deleteImageFiles(dir, [replaced]);
  return store.db.select().from(t.newsImages).where(and(eq(t.newsImages.articleId, articleId), eq(t.newsImages.variant, variant))).get()!;
}

/** Deletes copies whose rows are gone; one already missing is fine. */
export function deleteImageFiles(dir: string | null, files: readonly string[]) {
  if (!dir) return;
  for (const file of files) fs.rmSync(path.join(dir, path.basename(file)), {force: true});
}

/** A copy's bytes, for /api/news/images/:id; null when there's no such image or its file is gone. */
export function readNewsImage(store: Store, dir: string | null, imageId: number): {bytes: Buffer; mimeType: string} | null {
  const row = store.db.select().from(t.newsImages).where(eq(t.newsImages.id, imageId)).get();
  if (!row || !dir) return null;
  try {
    return {bytes: fs.readFileSync(path.join(dir, path.basename(row.file))), mimeType: row.mimeType};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
