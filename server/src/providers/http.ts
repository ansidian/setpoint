// One way to call a provider over HTTP(S), shared by Google Calendar, Places, Routes, Todoist and
// weather: JSON in and out, a per-request timeout on top of the engine's signal, and every failure
// turned into a ProviderError the one retry policy understands, carrying the provider's own words.
// Base URLs are injected, so tests point every adapter at a fake server on 127.0.0.1.
import {STATUS_CODES} from 'node:http';
import {kindOfStatus, ProviderError} from '../sync/errors.ts';
import type {ProviderErrorKind} from '../domain/retry.ts';

export interface HttpOptions {
  // The network: tests pass nothing and use fake servers' base URLs; the default is fetch.
  fetch?: typeof fetch;
  // One request's limit, within the engine's own.
  timeoutMs?: number;
}

export interface Request {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  // An object is sent as JSON; URLSearchParams as a form.
  body?: unknown;
  signal?: AbortSignal;
}

/** How a provider says no: its message, and a kind when its body knows better than the status. */
export interface Refusal {
  message: string;
  kind?: ProviderErrorKind;
}

export type ReadRefusal = (status: number, text: string) => Refusal;

export const DEFAULT_TIMEOUT_MS = 30_000;

/** "Conflict" for 409: the reason phrase, whatever the transport sent. */
export const reasonPhrase = (status: number) => STATUS_CODES[status] ?? 'Error';

/** Retry-After in seconds or as a date, as ms; null without one. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * Sends one request and returns the parsed JSON (null for an empty answer), or throws a
 * ProviderError: the provider's refusal by status (401 auth, 429 rate limited, 5xx transient,
 * others permanent, unless `refusal` says otherwise), a timeout or a dropped connection as
 * transient.
 */
export async function requestJson<T>(options: HttpOptions, request: Request, readRefusal: ReadRefusal, name: string): Promise<T> {
  const fetcher = options.fetch ?? fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
  const headers: Record<string, string> = {accept: 'application/json', ...request.headers};
  let body: string | undefined;
  if (request.body instanceof URLSearchParams) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = request.body.toString();
  } else if (request.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(request.body);
  }
  let response: Response;
  try {
    response = await fetcher(request.url, {method: request.method ?? 'GET', headers, body, signal});
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new ProviderError('transient', `${name} didn't answer in time.`);
    }
    const cause = error instanceof Error && error.cause instanceof Error ? ` (${(error.cause as NodeJS.ErrnoException).code ?? error.cause.message})` : '';
    throw new ProviderError('transient', `Couldn't reach ${name}${cause}.`);
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new ProviderError('transient', `${name} didn't answer in time.`);
  }
  if (!response.ok) {
    const refusal = readRefusal(response.status, text);
    throw new ProviderError(refusal.kind ?? kindOfStatus(response.status), refusal.message, {
      status: response.status, retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
    });
  }
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError('transient', `${name} answered with something that isn't JSON.`, {status: response.status});
  }
}

/** A refusal read as `{error: …}` JSON or plain text, with the status as the fallback words. */
export function plainRefusal(status: number, text: string): Refusal {
  const trimmed = text.trim();
  return {message: trimmed && trimmed.length <= 300 && !trimmed.startsWith('<') ? `${trimmed} (${status} ${reasonPhrase(status)})` : `${status} ${reasonPhrase(status)}`};
}
