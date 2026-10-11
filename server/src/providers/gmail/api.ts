// The Gmail API calls Setpoint makes (users.me), each a plain HTTPS request through googleRequest.
import type {AdapterContext} from '../../sync/adapter.ts';
import {googleRequest} from '../google/auth.ts';
import type {GoogleClient, GoogleTokens} from '../google/auth.ts';

export interface GmailMessageRef {
  id: string;
  threadId?: string;
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  internalDate?: string;
  historyId?: string;
  // format=raw: the RFC 822 source, base64url.
  raw?: string;
}

export interface GmailHistoryEvent {
  message?: GmailMessage;
  labelIds?: string[];
}

export interface GmailHistoryRecord {
  id?: string;
  messagesAdded?: GmailHistoryEvent[];
  messagesDeleted?: GmailHistoryEvent[];
  labelsAdded?: GmailHistoryEvent[];
  labelsRemoved?: GmailHistoryEvent[];
}

/** history.list answered 404: the start history id is too old to page from (about a week). */
export class HistoryGone extends Error {
  constructor() {
    super('Gmail no longer has history that old.');
    this.name = 'HistoryGone';
  }
}

export class GmailApi {
  private readonly client: GoogleClient;
  private readonly tokens: GoogleTokens;
  private readonly context: AdapterContext;

  constructor(client: GoogleClient, tokens: GoogleTokens, context: AdapterContext) {
    this.client = client;
    this.tokens = tokens;
    this.context = context;
  }

  private url(path: string) {
    return `${this.client.endpoints.gmail}/gmail/v1/users/me/${path}`;
  }

  private request(path: string, options: Parameters<typeof googleRequest>[4]) {
    return googleRequest(this.client, this.tokens, this.context, this.url(path), options);
  }

  async profile(): Promise<{emailAddress: string; historyId: string}> {
    return await (await this.request('profile', {what: 'Gmail profile'})).json() as {emailAddress: string; historyId: string};
  }

  /** One page of message ids, newest first. */
  async list(query: {q?: string; labelIds?: string[]; pageToken?: string | null; maxResults: number}): Promise<{messages: GmailMessageRef[]; nextPageToken: string | null; resultSizeEstimate: number}> {
    const response = await this.request('messages', {
      what: 'Gmail messages.list',
      query: {q: query.q, labelIds: query.labelIds, pageToken: query.pageToken ?? undefined, maxResults: query.maxResults},
    });
    const body = await response.json() as {messages?: GmailMessageRef[]; nextPageToken?: string; resultSizeEstimate?: number};
    return {messages: body.messages ?? [], nextPageToken: body.nextPageToken ?? null, resultSizeEstimate: body.resultSizeEstimate ?? 0};
  }

  /** Every id a query lists, up to a cap of pages (500 ids each). */
  async listAll(query: {q?: string; labelIds?: string[]}, maxPages = 20): Promise<{ids: string[]; complete: boolean}> {
    const ids: string[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < maxPages; page += 1) {
      const result = await this.list({...query, pageToken, maxResults: 500});
      ids.push(...result.messages.map(message => message.id));
      pageToken = result.nextPageToken;
      if (!pageToken) return {ids, complete: true};
    }
    return {ids, complete: false};
  }

  /** A message with its source, or null when Gmail no longer has it. */
  async raw(id: string): Promise<GmailMessage | null> {
    const response = await this.request(`messages/${encodeURIComponent(id)}`, {what: 'Gmail messages.get', query: {format: 'raw'}, accept: [404]});
    return response.status === 404 ? null : await response.json() as GmailMessage;
  }

  /** A message's labels only (read, trash, inbox), or null when Gmail no longer has it. */
  async labels(id: string): Promise<GmailMessage | null> {
    const response = await this.request(`messages/${encodeURIComponent(id)}`, {what: 'Gmail messages.get', query: {format: 'minimal'}, accept: [404]});
    return response.status === 404 ? null : await response.json() as GmailMessage;
  }

  /** One page of history since a history id; throws HistoryGone when that's too old. */
  async history(startHistoryId: string, pageToken: string | null): Promise<{history: GmailHistoryRecord[]; historyId: string | null; nextPageToken: string | null}> {
    const response = await this.request('history', {
      what: 'Gmail history.list', accept: [404],
      query: {startHistoryId, pageToken: pageToken ?? undefined, historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'], maxResults: 500},
    });
    if (response.status === 404) throw new HistoryGone();
    const body = await response.json() as {history?: GmailHistoryRecord[]; historyId?: string; nextPageToken?: string};
    return {history: body.history ?? [], historyId: body.historyId ?? null, nextPageToken: body.nextPageToken ?? null};
  }

  async modify(id: string, add: string[], remove: string[]): Promise<void> {
    await this.request(`messages/${encodeURIComponent(id)}/modify`, {what: 'Gmail messages.modify', method: 'POST', body: {addLabelIds: add, removeLabelIds: remove}});
  }

  /** Up to 1,000 messages in one call (Mark all as read). */
  async batchModify(ids: string[], add: string[], remove: string[]): Promise<void> {
    await this.request('messages/batchModify', {what: 'Gmail messages.batchModify', method: 'POST', body: {ids, addLabelIds: add, removeLabelIds: remove}});
  }

  async trash(id: string): Promise<void> {
    await this.request(`messages/${encodeURIComponent(id)}/trash`, {what: 'Gmail messages.trash', method: 'POST'});
  }

  async untrash(id: string): Promise<void> {
    await this.request(`messages/${encodeURIComponent(id)}/untrash`, {what: 'Gmail messages.untrash', method: 'POST'});
  }

  /** users.watch on the inbox, publishing to the Pub/Sub topic. */
  async watch(topicName: string): Promise<{historyId: string; expiration: string}> {
    const response = await this.request('watch', {what: 'Gmail users.watch', method: 'POST', body: {topicName, labelIds: ['INBOX'], labelFilterBehavior: 'INCLUDE'}});
    return await response.json() as {historyId: string; expiration: string};
  }
}
