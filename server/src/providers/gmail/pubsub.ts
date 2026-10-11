// Gmail's push trigger: Pub/Sub **pull** on v2's own subscription (BRIEF.md › Decided elsewhere),
// harvested from v1's gmail-pull and gmailPubSubNotification (see SV-3). Gmail publishes
// {emailAddress, historyId} to the topic whenever a watched inbox changes; each notification
// queues that account's sync (a durable job) and is acknowledged only after that. The
// notification is only a trigger: the sync pages history from Setpoint's own cursor, and the
// sweep catches anything a lost notification missed.
//
// It talks to Pub/Sub's REST API over HTTPS with a service account's token (a JWT signed here with
// node:crypto), not the SDK, so tests fake it at the HTTP boundary.
import {createSign} from 'node:crypto';
import fs from 'node:fs';
import {and, eq, sql} from 'drizzle-orm';
import * as t from '../../db/schema.ts';
import type {Store} from '../../store.ts';
import {googleError, tokenRequest} from '../google/auth.ts';
import type {GoogleEndpoints} from '../google/auth.ts';

/** A Google service-account key file's fields Setpoint uses. */
export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

export interface PubSubSettings {
  // projects/<project>/topics/<topic>: what users.watch publishes to.
  topic: string;
  // projects/<project>/subscriptions/<subscription>: v2's own pull subscription on that topic.
  subscription: string;
  serviceAccount: ServiceAccountKey;
}

export const TOPIC_PATTERN = /^projects\/[A-Za-z0-9._:-]+\/topics\/[A-Za-z0-9._~+%-]+$/;
export const SUBSCRIPTION_PATTERN = /^projects\/[a-z][a-z0-9-]+\/subscriptions\/[A-Za-z][A-Za-z0-9._~+%-]+$/;

export function readServiceAccount(file: string): ServiceAccountKey {
  const key = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ServiceAccountKey>;
  if (!key.client_email || !key.private_key) throw new Error(`${file} isn't a Google service-account key (client_email and private_key).`);
  return {client_email: key.client_email, private_key: key.private_key};
}

export interface GmailNotification {
  emailAddress: string;
  historyId: string;
}

/**
 * Gmail's notification in a Pub/Sub message: base64 JSON with emailAddress and historyId (v1's
 * decode, lower-casing the address). Null for anything else: it can never be processed.
 */
export function decodeNotification(data: string | undefined): GmailNotification | null {
  if (!data) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64').toString('utf8')) as {emailAddress?: unknown; historyId?: unknown};
    const emailAddress = String(payload.emailAddress ?? '').trim().toLowerCase();
    const historyId = String(payload.historyId ?? '').trim();
    return emailAddress && historyId ? {emailAddress, historyId} : null;
  } catch {
    return null;
  }
}

const SCOPE = 'https://www.googleapis.com/auth/pubsub';

/** A service account's access token by the JWT bearer grant (RFC 7523), cached until near its expiry. */
export class ServiceAccountTokens {
  private readonly key: ServiceAccountKey;
  private readonly endpoints: GoogleEndpoints;
  private cached: {token: string; until: number} | null = null;

  constructor(key: ServiceAccountKey, endpoints: GoogleEndpoints) {
    this.key = key;
    this.endpoints = endpoints;
  }

  async token(signal?: AbortSignal): Promise<string> {
    if (this.cached && this.cached.until > Date.now()) return this.cached.token;
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({alg: 'RS256', typ: 'JWT'})}.${encode({iss: this.key.client_email, scope: SCOPE, aud: this.endpoints.token, iat: now, exp: now + 3600})}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(this.key.private_key).toString('base64url');
    const tokens = await tokenRequest({endpoints: this.endpoints}, {grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}`}, signal);
    if (!tokens.access_token) throw new Error('Google answered without an access token.');
    this.cached = {token: tokens.access_token, until: Date.now() + ((tokens.expires_in ?? 3600) - 300) * 1000};
    return tokens.access_token;
  }
}

export type PullState = 'stopped' | 'listening' | 'retrying';

export interface PullerOptions {
  store: Store;
  settings: PubSubSettings;
  endpoints: GoogleEndpoints;
  // Queues the source's sync (the engine's `pushed`, a durable job).
  onPush: (sourceId: number) => void;
  maxMessages?: number;
}

interface ReceivedMessage {
  ackId: string;
  message?: {data?: string; messageId?: string; publishTime?: string};
}

/** v1's backoff after a failed pull: 1 s, doubling to a minute. */
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 60_000;

export class GmailPushPuller {
  private readonly options: PullerOptions;
  private readonly tokens: ServiceAccountTokens;
  private stopping = new AbortController();
  private loop: Promise<void> | null = null;
  private retryMs = RETRY_FIRST_MS;
  state: PullState = 'stopped';
  lastMessageAt: string | null = null;
  lastError: string | null = null;

  constructor(options: PullerOptions) {
    this.options = options;
    this.tokens = new ServiceAccountTokens(options.settings.serviceAccount, options.endpoints);
  }

  private async post(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
    const response = await fetch(`${this.options.endpoints.pubsub}/v1/${path}`, {
      method: 'POST', body: JSON.stringify(body), signal,
      headers: {authorization: `Bearer ${await this.tokens.token(signal)}`, 'content-type': 'application/json'},
    });
    if (!response.ok) throw await googleError(response, 'Pub/Sub');
    return response;
  }

  /** The Gmail source for a notification's address (a real one, never a dev source). */
  private sourceFor(address: string): number | null {
    const row = this.options.store.db.select({id: t.sources.id}).from(t.sources)
      .innerJoin(t.accounts, eq(t.accounts.id, t.sources.accountId))
      .where(and(eq(t.sources.provider, 'gmail'), eq(t.sources.dev, false), eq(sql`lower(${t.accounts.address})`, address))).get();
    return row?.id ?? null;
  }

  /**
   * One pull: each notification queues its account's sync, then everything handled is
   * acknowledged. A notification that can't be decoded, or names an account Setpoint doesn't
   * have, is acknowledged and dropped: it carries nothing the sweep won't find. One whose sync
   * couldn't be queued isn't acknowledged, so Pub/Sub delivers it again.
   */
  async pullOnce(signal: AbortSignal = this.stopping.signal): Promise<{received: number; pushed: number[]}> {
    const response = await this.post(`${this.options.settings.subscription}:pull`, {maxMessages: this.options.maxMessages ?? 10}, signal);
    const {receivedMessages = []} = await response.json() as {receivedMessages?: ReceivedMessage[]};
    const ackIds: string[] = [];
    const pushed = new Set<number>();
    for (const received of receivedMessages) {
      const notification = decodeNotification(received.message?.data);
      const sourceId = notification ? this.sourceFor(notification.emailAddress) : null;
      try {
        if (sourceId !== null && !pushed.has(sourceId)) this.options.onPush(sourceId);
        if (sourceId !== null) pushed.add(sourceId);
        ackIds.push(received.ackId);
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
      }
    }
    if (ackIds.length) await this.post(`${this.options.settings.subscription}:acknowledge`, {ackIds}, signal);
    if (receivedMessages.length) this.lastMessageAt = new Date().toISOString();
    return {received: receivedMessages.length, pushed: [...pushed]};
  }

  /** Pulls continuously until stopped, backing off after failures. */
  start() {
    if (this.loop) return;
    this.stopping = new AbortController();
    const signal = this.stopping.signal;
    this.loop = (async () => {
      while (!signal.aborted) {
        try {
          await this.pullOnce(signal);
          this.state = 'listening';
          this.retryMs = RETRY_FIRST_MS;
        } catch (error) {
          if (signal.aborted) break;
          this.state = 'retrying';
          // Provider errors can carry notification contents; log the gist only (v1).
          this.lastError = error instanceof Error ? error.message : String(error);
          console.error(`Gmail push: pull failed, retrying in ${this.retryMs / 1000}s (the sweep keeps mail current meanwhile)`);
          await new Promise(resolve => {
            const timer = setTimeout(resolve, this.retryMs);
            timer.unref();
            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              resolve(undefined);
            }, {once: true});
          });
          this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
        }
      }
      this.state = 'stopped';
    })();
  }

  async stop() {
    this.stopping.abort();
    await this.loop;
    this.loop = null;
  }
}
