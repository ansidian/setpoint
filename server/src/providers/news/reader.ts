// Reading a new News article (N2; BRIEF.md › The page: Thumbnails; When things break): its page for
// the readable text and its og:image, and the best image copied at Setpoint's two sizes, cropped to
// fill, so outlets never see the user's browsing and a blocked hotlink can't break a row. The best image
// is the feed's (Media RSS or an enclosure); the page's og:image stands in when the feed has none,
// or when the feed's is smaller than the large copy and the page's is bigger. Nothing is ever
// generated. Whatever can't be read is left out quietly: the article keeps its feed summary.
import sharp from 'sharp';
import {IMAGE_SIZES} from '../../domain/news.ts';
import type {ImageVariant} from '../../domain/news.ts';
import {usableImage} from '../../domain/newsIngest.ts';
import type {ReadingPlan} from '../../domain/newsIngest.ts';
import {extractArticle} from '../../domain/newsPages.ts';
import type {ArticleReading, NewsArticleReader, NewsReadContext} from '../../news/adapter.ts';
import type {ImageCopy} from '../../news/images.ts';
import {newsGet, PAGE_MAX_BYTES, responseText} from './http.ts';
import type {NewsHttpOptions} from './http.ts';

const IMAGE_MAX_BYTES = 15 * 1024 * 1024;
// What an image may be: the formats a photo comes in. Never SVG, which is a document, not a picture.
const IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif']);

interface Picture {
  url: string;
  bytes: Buffer;
  width: number;
  height: number;
}

/** An image's bytes and size, when it's a photo worth copying; null otherwise. */
async function fetchPicture(options: NewsHttpOptions, context: NewsReadContext, url: string): Promise<Picture | null> {
  try {
    const response = await newsGet(options, {url, userAgent: context.userAgent, signal: context.signal, accept: 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8', maxBytes: IMAGE_MAX_BYTES});
    if (response.status !== 200 && response.status !== 203) return null;
    const metadata = await sharp(response.body, {failOn: 'error', limitInputPixels: 40_000_000}).metadata();
    if (!metadata.format || !IMAGE_FORMATS.has(metadata.format) || !metadata.width || !metadata.height) return null;
    // A photo turned on its side by its EXIF is measured as it's shown.
    const turned = (metadata.orientation ?? 1) >= 5;
    const width = turned ? metadata.height : metadata.width;
    const height = turned ? metadata.width : metadata.height;
    return usableImage(width, height) ? {url, bytes: response.body, width, height} : null;
  } catch {
    return null;
  }
}

/** One copy: turned upright, cropped to fill the size from its middle, as WebP. */
async function copyAt(picture: Picture, variant: ImageVariant): Promise<ImageCopy> {
  const size = IMAGE_SIZES[variant];
  const bytes = await sharp(picture.bytes, {failOn: 'error', limitInputPixels: 40_000_000, animated: false})
    .rotate()
    .resize({...size, fit: 'cover', position: 'centre'})
    .webp({quality: variant === 'large' ? 78 : 72})
    .toBuffer();
  return {bytes, mimeType: 'image/webp', ...size};
}

/** The bigger of two pictures, by pixels. */
const bigger = (a: Picture | null, b: Picture | null) => (!a ? b : !b ? a : b.width * b.height > a.width * a.height ? b : a);
const fillsLarge = (picture: Picture) => picture.width >= IMAGE_SIZES.large.width && picture.height >= IMAGE_SIZES.large.height;

export function newsReader(options: NewsHttpOptions = {}): NewsArticleReader {
  return {
    async read(context, article, plan: ReadingPlan): Promise<ArticleReading> {
      let text: string | null = null;
      let pageImage: string | null = null;
      if (plan.page) {
        try {
          const response = await newsGet(options, {url: article.url, userAgent: context.userAgent, signal: context.signal, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', maxBytes: PAGE_MAX_BYTES});
          const type = response.headers.get('content-type') ?? '';
          if (response.status === 200 && (!type || /html|xml/i.test(type))) {
            const extracted = extractArticle(responseText(response), response.url);
            text = extracted.text;
            pageImage = extracted.imageUrl;
          }
        } catch {
          // A page that can't be read leaves the article on its feed summary.
        }
      }
      if (!plan.image || context.signal.aborted) return {text, imageUrl: null, images: []};
      let picture = article.imageUrl ? await fetchPicture(options, context, article.imageUrl) : null;
      if (pageImage && pageImage !== article.imageUrl && (!picture || !fillsLarge(picture))) picture = bigger(picture, await fetchPicture(options, context, pageImage));
      if (!picture) return {text, imageUrl: null, images: []};
      try {
        const images = [{variant: 'large' as const, copy: await copyAt(picture, 'large')}, {variant: 'thumb' as const, copy: await copyAt(picture, 'thumb')}];
        return {text, imageUrl: picture.url, images};
      } catch {
        return {text, imageUrl: null, images: []};
      }
    },
  };
}
