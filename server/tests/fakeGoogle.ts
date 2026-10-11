// A fake Google on 127.0.0.1 answering as Google does: OAuth's token endpoint (code exchange,
// refresh, a service account's JWT grant, `invalid_grant` once revoked), Gmail's users.me API
// (profile, messages, history with its 404 when too old, modify, batchModify, trash and untrash,
// watch) and Pub/Sub's pull and acknowledge. Tests change mailboxes "elsewhere" (read in Gmail's
// app, archived, deleted) and inject Google's errors (401, 429 with Retry-After, 5xx, a hang).
// No test reaches real Google.
import {createVerify, randomBytes} from 'node:crypto';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {onTestFinished} from 'vitest';
import type {GoogleClient} from '../src/providers/google/auth.ts';

interface FakeMessage {
  id: string;
  threadId: string;
  labels: Set<string>;
  internalDate: number;
  raw: Buffer;
}

interface HistoryEntry {
  id: number;
  record: Record<string, unknown>;
}

class Mailbox {
  readonly address: string;
  readonly messages = new Map<string, FakeMessage>();
  readonly history: HistoryEntry[] = [];
  historyId = 1000;
  // history.list from before this answers 404.
  oldestHistory = 0;

  constructor(address: string) {
    this.address = address;
  }

  private ref(message: FakeMessage) {
    return {id: message.id, threadId: message.threadId, labelIds: [...message.labels]};
  }

  record(kind: 'messagesAdded' | 'messagesDeleted' | 'labelsAdded' | 'labelsRemoved', message: FakeMessage, labelIds?: string[]) {
    this.historyId += 1;
    this.history.push({id: this.historyId, record: {id: String(this.historyId), [kind]: [{message: this.ref(message), ...(labelIds ? {labelIds} : {})}]}});
  }

  change(message: FakeMessage, add: string[], remove: string[]) {
    const added = add.filter(label => !message.labels.has(label));
    const removed = remove.filter(label => message.labels.has(label));
    for (const label of added) message.labels.add(label);
    for (const label of removed) message.labels.delete(label);
    if (added.length) this.record('labelsAdded', message, added);
    if (removed.length) this.record('labelsRemoved', message, removed);
  }
}

type Injected = {status: number; body?: unknown; headers?: Record<string, string>} | 'hang';

export interface Delivery {
  raw: Buffer;
  date: string;
  labels?: string[];
  threadId?: string;
}

// `clock` is the test's, for the times Google stamps (a watch's expiry, a push's publish time).
export async function fakeGoogle({publicKey, clock = () => new Date()}: {publicKey?: string; clock?: () => Date} = {}) {
  const mailboxes = new Map<string, Mailbox>();
  const codes = new Map<string, string>();
  const refreshTokens = new Map<string, string>();
  const accessTokens = new Map<string, string>();
  const revoked = new Set<string>();
  const pubsubQueue: {ackId: string; data: string}[] = [];
  const injected: {pattern: RegExp; response: Injected; times: number}[] = [];
  const requests: {method: string; path: string; query: URLSearchParams; body: unknown}[] = [];
  const hanging: http.ServerResponse[] = [];
  let nextId = 1;

  const mailbox = (address: string) => {
    const found = mailboxes.get(address);
    if (!found) throw new Error(`No fake mailbox ${address}`);
    return found;
  };
  const message = (address: string, id: string) => {
    const found = mailbox(address).messages.get(id);
    if (!found) throw new Error(`No message ${id}`);
    return found;
  };

  const json = (response: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    response.writeHead(status, {'content-type': 'application/json', ...headers}).end(body === undefined ? '' : JSON.stringify(body));
  };
  const apiError = (response: http.ServerResponse, status: number, message: string, reason = 'notFound') =>
    json(response, status, {error: {code: status, message, errors: [{reason}], status: 'ERROR'}});

  function handleToken(form: URLSearchParams, response: http.ServerResponse) {
    const grant = form.get('grant_type');
    const issue = (address: string, refresh?: string) => {
      const token = `ya29.${randomBytes(8).toString('hex')}`;
      accessTokens.set(token, address);
      return json(response, 200, {access_token: token, expires_in: 3599, token_type: 'Bearer', scope: 'https://www.googleapis.com/auth/gmail.modify', ...(refresh ? {refresh_token: refresh} : {})});
    };
    if (grant === 'authorization_code') {
      const address = codes.get(form.get('code') ?? '');
      if (!address) return json(response, 400, {error: 'invalid_grant', error_description: 'Malformed auth code.'});
      codes.delete(form.get('code')!);
      const refresh = `1//${randomBytes(8).toString('hex')}`;
      refreshTokens.set(refresh, address);
      return issue(address, refresh);
    }
    if (grant === 'refresh_token') {
      const refresh = form.get('refresh_token') ?? '';
      const address = refreshTokens.get(refresh);
      if (!address || revoked.has(refresh)) return json(response, 400, {error: 'invalid_grant', error_description: 'Token has been expired or revoked.'});
      return issue(address);
    }
    if (grant === 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
      const [header, claims, signature] = (form.get('assertion') ?? '').split('.');
      const valid = publicKey && header && claims && signature && createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, 'base64url'));
      if (!valid) return json(response, 400, {error: 'invalid_grant', error_description: 'Invalid JWT Signature.'});
      return issue('service-account');
    }
    return json(response, 400, {error: 'unsupported_grant_type'});
  }

  function handleGmail(address: string, method: string, path: string, query: URLSearchParams, body: Record<string, unknown>, response: http.ServerResponse) {
    const box = mailbox(address);
    const route = path.replace('/gmail/v1/users/me/', '');
    if (route === 'profile') return json(response, 200, {emailAddress: box.address, historyId: String(box.historyId), messagesTotal: box.messages.size});
    if (route === 'watch' && method === 'POST') return json(response, 200, {historyId: String(box.historyId), expiration: String(clock().getTime() + 7 * 24 * 60 * 60_000)});
    if (route === 'history') {
      const start = Number(query.get('startHistoryId'));
      if (start < box.oldestHistory) return apiError(response, 404, 'Requested entity was not found.');
      const all = box.history.filter(entry => entry.id > start);
      const offset = Number(query.get('pageToken') ?? 0);
      const size = Math.min(Number(query.get('maxResults') ?? 100), fake.historyPageSize);
      const page = all.slice(offset, offset + size);
      return json(response, 200, {
        ...(page.length ? {history: page.map(entry => entry.record)} : {}), historyId: String(box.historyId),
        ...(offset + size < all.length ? {nextPageToken: String(offset + size)} : {}),
      });
    }
    if (route === 'messages' && method === 'GET') {
      const labels = query.getAll('labelIds');
      const after = /after:(\d+)/.exec(query.get('q') ?? '')?.[1];
      const matching = [...box.messages.values()]
        .filter(item => labels.every(label => item.labels.has(label)) && (!after || item.internalDate >= Number(after) * 1000))
        .sort((a, b) => b.internalDate - a.internalDate);
      const offset = Number(query.get('pageToken') ?? 0);
      const size = Number(query.get('maxResults') ?? 100);
      const page = matching.slice(offset, offset + size);
      return json(response, 200, {
        ...(page.length ? {messages: page.map(item => ({id: item.id, threadId: item.threadId}))} : {}),
        resultSizeEstimate: matching.length + fake.estimateSkew,
        ...(offset + size < matching.length ? {nextPageToken: String(offset + size)} : {}),
      });
    }
    if (route === 'messages/batchModify' && method === 'POST') {
      for (const id of body.ids as string[]) {
        const item = box.messages.get(id);
        if (item) box.change(item, (body.addLabelIds ?? []) as string[], (body.removeLabelIds ?? []) as string[]);
      }
      response.writeHead(204).end();
      return;
    }
    const match = /^messages\/([^/]+)(?:\/(modify|trash|untrash))?$/.exec(route);
    const item = match ? box.messages.get(decodeURIComponent(match[1]!)) : undefined;
    if (match && !item) return apiError(response, 404, 'Requested entity was not found.');
    if (match && item) {
      const action = match[2];
      if (!action && method === 'GET') {
        const format = query.get('format');
        return json(response, 200, {
          id: item.id, threadId: item.threadId, labelIds: [...item.labels], historyId: String(box.historyId), internalDate: String(item.internalDate),
          ...(format === 'raw' ? {raw: item.raw.toString('base64url'), sizeEstimate: item.raw.length} : {}),
        });
      }
      if (action === 'modify') box.change(item, (body.addLabelIds ?? []) as string[], (body.removeLabelIds ?? []) as string[]);
      if (action === 'trash') box.change(item, ['TRASH'], ['INBOX']);
      if (action === 'untrash') box.change(item, ['INBOX'], ['TRASH']);
      return json(response, 200, {id: item.id, threadId: item.threadId, labelIds: [...item.labels]});
    }
    return apiError(response, 404, `No fake route ${method} ${path}`);
  }

  function handlePubSub(path: string, body: Record<string, unknown>, response: http.ServerResponse) {
    if (path.endsWith(':pull')) {
      const max = Number(body.maxMessages ?? 10);
      const messages = pubsubQueue.slice(0, max);
      return json(response, 200, messages.length ? {receivedMessages: messages.map(item => ({
        ackId: item.ackId, message: {data: item.data, messageId: item.ackId, publishTime: clock().toISOString()},
      }))} : {});
    }
    if (path.endsWith(':acknowledge')) {
      for (const ackId of body.ackIds as string[]) {
        const at = pubsubQueue.findIndex(item => item.ackId === ackId);
        if (at >= 0) pubsubQueue.splice(at, 1);
      }
      return json(response, 200, {});
    }
    return json(response, 404, {error: {code: 404, message: 'Resource not found', status: 'NOT_FOUND'}});
  }

  const server = http.createServer((request, response) => {
    let text = '';
    request.on('data', chunk => (text += chunk));
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const method = request.method ?? 'GET';
      const isForm = request.headers['content-type']?.includes('x-www-form-urlencoded');
      const body = isForm ? Object.fromEntries(new URLSearchParams(text)) : text ? JSON.parse(text) as Record<string, unknown> : {};
      requests.push({method, path: url.pathname, query: url.searchParams, body});
      const rule = injected.find(candidate => candidate.times > 0 && candidate.pattern.test(`${method} ${url.pathname}`));
      if (rule) {
        rule.times -= 1;
        if (rule.response === 'hang') {
          hanging.push(response);
          return;
        }
        return json(response, rule.response.status, rule.response.body ?? {error: {code: rule.response.status, message: 'Injected', status: 'ERROR'}}, rule.response.headers);
      }
      if (url.pathname === '/token') return handleToken(new URLSearchParams(text), response);
      const token = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
      const address = accessTokens.get(token);
      if (!address) return json(response, 401, {error: {code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED'}});
      if (url.pathname.startsWith('/gmail/')) return handleGmail(address, method, url.pathname, url.searchParams, body as Record<string, unknown>, response);
      if (url.pathname.startsWith('/v1/projects/')) return handlePubSub(url.pathname, body as Record<string, unknown>, response);
      return json(response, 404, {error: {code: 404, message: 'Not found'}});
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  onTestFinished(() => new Promise<void>(resolve => {
    for (const response of hanging) response.destroy();
    server.closeAllConnections();
    server.close(() => resolve());
  }));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const fake = {
    url, requests, mailboxes,
    historyPageSize: 500,
    // Gmail's resultSizeEstimate is rough; this skews it.
    estimateSkew: 0,
    endpoints: {consent: `${url}/o/oauth2/v2/auth`, token: `${url}/token`, gmail: url, pubsub: url},
    client(): GoogleClient {
      return {clientId: 'client-id.apps.example.com', clientSecret: 'client-secret', endpoints: fake.endpoints, requestTimeoutMs: 2000};
    },
    addMailbox(address: string) {
      mailboxes.set(address, new Mailbox(address));
    },
    /** A consent finished for this mailbox: the code Google's redirect would carry. */
    issueCode(address: string) {
      const code = `4/${randomBytes(6).toString('hex')}`;
      codes.set(code, address);
      return code;
    },
    /** A refresh token as if consent had happened earlier. */
    refreshTokenFor(address: string) {
      const refresh = `1//${randomBytes(8).toString('hex')}`;
      refreshTokens.set(refresh, address);
      return refresh;
    },
    /** The user removed Setpoint's access (or Google expired it): refreshes answer invalid_grant, and access tokens die. */
    revoke(address: string) {
      for (const [token, owner] of refreshTokens) if (owner === address) revoked.add(token);
      for (const [token, owner] of accessTokens) if (owner === address) accessTokens.delete(token);
    },
    /** Access tokens stop working (expired early); refreshing still works. */
    expireAccessTokens() {
      accessTokens.clear();
    },
    deliver(address: string, delivery: Delivery): string {
      const box = mailbox(address);
      const id = `18f${(nextId++).toString(16).padStart(13, '0')}`;
      const item: FakeMessage = {id, threadId: delivery.threadId ?? id, labels: new Set(delivery.labels ?? ['INBOX', 'UNREAD']), internalDate: Date.parse(delivery.date), raw: delivery.raw};
      box.messages.set(id, item);
      box.record('messagesAdded', item);
      return id;
    },
    labels: (address: string, id: string) => [...message(address, id).labels].sort(),
    change: (address: string, id: string, add: string[], remove: string[]) => mailbox(address).change(message(address, id), add, remove),
    deleteForever(address: string, id: string) {
      const box = mailbox(address);
      const item = message(address, id);
      box.messages.delete(id);
      box.record('messagesDeleted', item);
    },
    /** Gmail keeps about a week of history: anything before now answers 404. */
    forgetHistory(address: string) {
      const box = mailbox(address);
      box.historyId += 10;
      box.oldestHistory = box.historyId;
    },
    /** Gmail publishes a change notification for a mailbox to the topic. */
    publish(address: string) {
      const data = Buffer.from(JSON.stringify({emailAddress: address, historyId: mailbox(address).historyId})).toString('base64');
      pubsubQueue.push({ackId: `ack-${randomBytes(4).toString('hex')}`, data});
    },
    publishRaw(data: string) {
      pubsubQueue.push({ackId: `ack-${randomBytes(4).toString('hex')}`, data});
    },
    get pending() {
      return pubsubQueue.length;
    },
    /** The next `times` requests matching "METHOD /path" get this answer instead (or hang). */
    inject(pattern: RegExp, response: Injected, times = 1) {
      injected.push({pattern, response, times});
    },
    count: (pattern: RegExp) => requests.filter(request => pattern.test(`${request.method} ${request.path}`)).length,
  };
  return fake;
}

export type FakeGoogle = Awaited<ReturnType<typeof fakeGoogle>>;
