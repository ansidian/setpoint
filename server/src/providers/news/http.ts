// News's one way to read the web (N2): a GET with Setpoint's honest User-Agent, a conditional GET's
// validators when it has them, a per-request limit on top of the job's signal, redirects followed by
// hand so none leads to the home network, and a cap on what it reads. Every failure is a
// ProviderError the one retry policy understands: a refusal by its status ("404 Not Found"), a 429,
// or a 503 that asks for a pause, with its Retry-After; a dropped connection or a timeout as
// transient. Tests point every source at a fake on 127.0.0.1, so `privateHosts` lets them.
import {decodeText, isPublicUrl, kindOfNewsStatus} from '../../domain/newsIngest.ts';
import {ProviderError} from '../../sync/errors.ts';
import {reasonPhrase, retryAfterMs} from '../http.ts';

export interface NewsHttpOptions {
  // The network: tests pass nothing and use fake servers' URLs; the default is fetch.
  fetch?: typeof fetch;
  // One request's limit, within the job's own.
  timeoutMs?: number;
  // Lets a read reach loopback and private hosts: only tests' fakes on 127.0.0.1.
  privateHosts?: boolean;
}

export interface NewsRequest {
  url: string;
  userAgent: string;
  signal: AbortSignal;
  accept: string;
  // The last answer's validators, for a conditional GET.
  etag?: string | null;
  lastModified?: string | null;
  // At most this many bytes are read.
  maxBytes?: number;
  headers?: Record<string, string>;
}

export interface NewsResponse {
  status: number;
  // Where the redirects led.
  url: string;
  headers: Headers;
  body: Buffer;
}

export const NEWS_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;
export const PAGE_MAX_BYTES = 5 * 1024 * 1024;

/** A source's name in its failures: its host. */
export const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

async function readCapped(response: Response, maxBytes: number, host: string): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = response.body.getReader();
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new ProviderError('permanent', `${host} sent more than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * GETs a URL and returns its answer: a 2xx with its body, or a 304 (nothing new since the
 * validators) with none. Anything else throws.
 */
export async function newsGet(options: NewsHttpOptions, request: NewsRequest): Promise<NewsResponse> {
  const fetcher = options.fetch ?? fetch;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(options.timeoutMs ?? NEWS_TIMEOUT_MS)]);
  const headers: Record<string, string> = {
    'user-agent': request.userAgent, accept: request.accept, 'accept-language': 'en-US,en;q=0.8', ...request.headers,
    ...(request.etag ? {'if-none-match': request.etag} : {}),
    ...(request.lastModified ? {'if-modified-since': request.lastModified} : {}),
  };
  let url = request.url;
  for (let hop = 0; ; hop += 1) {
    const host = hostOf(url);
    if (!options.privateHosts && !isPublicUrl(url)) throw new ProviderError('permanent', `${host} isn't a public web address.`);
    let response: Response;
    try {
      response = await fetcher(url, {method: 'GET', headers, signal, redirect: 'manual'});
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new ProviderError('transient', `${host} didn't answer in time.`);
      const cause = error instanceof Error && error.cause instanceof Error ? ` (${(error.cause as NodeJS.ErrnoException).code ?? error.cause.message})` : '';
      throw new ProviderError('transient', `Couldn't reach ${host}${cause}.`);
    }
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || hop >= MAX_REDIRECTS) throw new ProviderError('permanent', `${response.status} ${reasonPhrase(response.status)}, with ${location ? 'too many redirects' : 'nowhere to go'}.`, {status: response.status});
      url = new URL(location, url).toString();
      continue;
    }
    if (response.status === 304) {
      await response.body?.cancel();
      return {status: 304, url, headers: response.headers, body: Buffer.alloc(0)};
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const retryAfter = response.headers.get('retry-after');
      throw new ProviderError(kindOfNewsStatus(response.status, retryAfter !== null), `${response.status} ${reasonPhrase(response.status)}`, {
        status: response.status, retryAfterMs: retryAfterMs(retryAfter),
      });
    }
    let body: Buffer;
    try {
      body = await readCapped(response, request.maxBytes ?? PAGE_MAX_BYTES, host);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('transient', `${host} didn't answer in time.`);
    }
    return {status: response.status, url, headers: response.headers, body};
  }
}

/** A response's body as text in its charset. */
export const responseText = (response: NewsResponse) => decodeText(response.body, response.headers.get('content-type'));

/** A GET of JSON: the parsed answer, or a transient failure when it isn't JSON. */
export async function newsGetJson<T>(options: NewsHttpOptions, request: Omit<NewsRequest, 'accept'> & {accept?: string}): Promise<T> {
  const response = await newsGet(options, {accept: 'application/json', ...request});
  try {
    return JSON.parse(responseText(response)) as T;
  } catch {
    throw new ProviderError('transient', `${hostOf(request.url)} answered with something that isn't JSON.`, {status: response.status});
  }
}
