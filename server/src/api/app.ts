// The HTTP app: the JSON API under /api, the live stream at /api/events and, when built, the web
// app's files, from one origin, for one owner. Routes and their shapes are in
// `@setpoint/shared` (src/api/*.ts there lists them).
import fs from 'node:fs';
import path from 'node:path';
import {serveStatic} from '@hono/node-server/serve-static';
import {
  accountOrderInput, accountUpdateInput, gmailAuthorizeInput, icloudConnectInput, claimInput, commandListInput, credentialsInput, passkeyResponseInput, recoverInput, SECRET_NAMES, secretInput, settingsPatchInput, signInInput, ATTACHMENTS_MAX_BYTES,
} from '@setpoint/shared';
import type {
  ApiError, AccountOut, AuthStatusOut, GmailAuthorizeOut, HaStatusOut, ICloudConnectInput, MeOut, ReadyOut, RecoveryCodesOut, SecretName, SignInOut,
} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {Hono} from 'hono';
import type {Context, Next} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {HTTPException} from 'hono/http-exception';
import {streamSSE} from 'hono/streaming';
import type {SSEMessage} from 'hono/streaming';
import type {ContentfulStatusCode} from 'hono/utils/http-status';
import {z} from 'zod';
import {
  BCRYPT_COST, claimOwner, getOwner, passkeyCount, passwordMatches, passwordSignInOutcome, recover, reservePasswordAttempt, sweepExpiredAuth,
} from '../auth/owner.ts';
import {cancelPendingSignIn, passkeySignInOptions, relyingParty, startPendingSignIn, verifyPasskeySignIn} from '../auth/passkeys.ts';
import type {AlfredOptions} from '../alfred/ask.ts';
import type {WriteOptions} from '../alfred/write.ts';
import type {PrefillOptions} from '../alfred/prefill.ts';
import {haTokenMatches} from '../auth/haToken.ts';
import {createSession, endSession, findSession, hasRecentPassword} from '../auth/sessions.ts';
import type {Session} from '../auth/sessions.ts';
import {commandPresenter, activeCommands, getCommand, moveBackCommand, retryCommand} from '../commands/index.ts';
import type {CommandRow} from '../commands/index.ts';
import {ICS_MAX_BYTES} from '../domain/icsImport.ts';
import * as t from '../db/schema.ts';
import {conflict, forbidden, invalid, parse, SetpointError, unauthorized} from '../errors.ts';
import type {FeedEvent} from '../live/feed.ts';
import type {Notifier} from '../notify/index.ts';
import {CALENDAR_API} from '../providers/gcal/api.ts';
import type {PlacesOptions} from '../providers/gcal/places.ts';
import {admitPush} from '../providers/gcal/push.ts';
import {BIND_COOKIE, completeTodoistOAuth, TODOIST_CALLBACK_PATH, TodoistOAuthError} from '../providers/todoist/oauth.ts';
import type {TodoistOAuthOptions} from '../providers/todoist/oauth.ts';
import {admitTodoistWebhook, WEBHOOK_PATH} from '../providers/todoist/webhook.ts';
import type {SearchReaderOptions} from '../search/reading.ts';
import {enqueueJob, wakeSync} from '../sync/jobs.ts';
import {accountList, reorderAccounts, sourceList, updateAccount} from '../queries/sources.ts';
import {haStatus} from '../queries/status.ts';
import {deleteSecret, listSecrets, setSecret, writeSourceCredentials} from '../secrets/store.ts';
import {getSettings, updateSettings} from '../settings.ts';
import {isoNow, noteLive} from '../store.ts';
import type {Store} from '../store.ts';
import type {Connected} from '../sync/connect.ts';
import type {SyncEngine} from '../sync/engine.ts';
import {isAiKeySecret} from '../triage/models.ts';
import type {NewsSortWorker} from '../news/sortWorker.ts';
import type {TriageWorker} from '../triage/worker.ts';
import {clearCookie, cookieNames, fromOwnPage, readCookie, setPendingCookie, setSessionCookie} from './auth.ts';
import {deleteCookie} from 'hono/cookie';
import {newsApi} from './news.ts';
import type {NewsApiOptions} from './news.ts';
import {triageApi} from './triage.ts';
import {calendarApi, ICS_READ_PATH} from './calendar.ts';
import {mailApi} from './mail.ts';
import {searchApi} from './search.ts';
import {securityApi} from './security.ts';

// A request is signed in by the browser's session cookie. `alive` says whether it still is, for the
// live stream's checks.
export type Env = {Variables: {session: Session; alive: () => boolean}};

/**
 * Connecting mail accounts (Settings › Accounts), from the providers: Gmail's OAuth consent and
 * callback, and iCloud's app password checked against IMAP. It's absent where a provider isn't set
 * up (no Google client configured), and those routes then answer 503.
 */
export interface MailConnectors {
  gmail?: {
    authorizeUrl(redirectUri: string, account: {id: number; address: string} | null): string;
    complete(redirectUri: string, query: {code?: string; state?: string; error?: string}): Promise<Connected>;
  } | null;
  icloud?: {
    connect(input: ICloudConnectInput): Promise<Connected>;
  } | null;
}

/** The callback the Google client has registered, kept so its redirect URI still matches. */
export const GMAIL_CALLBACK_PATH = '/api/ea/accounts/gmail/callback';

export interface AppOptions {
  store: Store;
  // The built web app (web/dist), served when it holds an index.html.
  webDir?: string | null;
  publicUrl?: string | null;
  production?: boolean;
  engine?: SyncEngine | null;
  notifier?: Notifier | null;
  // How often an open stream sends a keep-alive and checks its session still works.
  keepAliveMs?: number;
  bcryptCost?: number;
  connectors?: MailConnectors;
  // The providers as the API reaches them (tests: fakes on 127.0.0.1).
  providers?: {
    // Google Calendar's base URL, which a push notification's resource URI must name.
    calendarApi?: string;
    places?: PlacesOptions;
    todoistOAuth?: TodoistOAuthOptions;
  };
  // Triage, told when AI keys or model choices change, so Unsorted mail is tried again at once.
  triage?: Pick<TriageWorker, 'configurationChanged'> | null;
  // Alfred's model endpoints (tests: a fake on 127.0.0.1).
  alfred?: AlfredOptions;
  // Help me write's, likewise, and the dev provider's canned draft for a dev run with no key.
  drafting?: WriteOptions;
  // The search reading's, likewise.
  reading?: Omit<SearchReaderOptions, 'store'>;
  // The proposal prefill's, likewise.
  prefill?: PrefillOptions;
  // Where News's image copies are (the data directory's news-images/).
  news?: NewsApiOptions;
  // Where drafts' attached files are kept (the data directory's draft-files/). Null refuses uploads.
  draftFiles?: string | null;
  // News sorting, told when the AI keys or settings change, so articles waiting Unsorted are sorted at once.
  newsSort?: Pick<NewsSortWorker, 'configurationChanged'> | null;
  // A removable module's routes (Jobs, from server.ts), mounted under /api behind the session after
  // the app's own, so the app never names the module.
  routes?: Hono[];
  // A removable module's routes that check their own bearer token (Jobs's check for the browser
  // extension), mounted under /api before the session, as Home Assistant's status is.
  tokenRoutes?: Hono[];
}

const MAX_STREAMS = 20;
const DRAFT_FILE_PATH = /^\/api\/mail\/drafts\/\d+\/files$/;
const id = (value: string) => parse(z.coerce.number().pipe(z.int().positive()), value);

async function body(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw invalid('The body must be JSON.');
  }
}

const errorBody = (code: string, message: string, details?: unknown): ApiError => ({error: {code, message, ...(details === undefined ? {} : {details})}});

/** The web app's policy: its own scripts, no framing, styles inline, images from its own origin. */
const WEB_POLICY = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'",
  "frame-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

export function createApp({store, webDir = null, publicUrl = null, production = false, engine = null, notifier = null, keepAliveMs = 25_000, bcryptCost = BCRYPT_COST, connectors = {}, providers = {}, triage = null, alfred = {}, drafting = {}, reading = {}, prefill = {}, news = {}, draftFiles = null, newsSort = null, routes = [], tokenRoutes = []}: AppOptions) {
  const app = new Hono<Env>();
  const cookies = cookieNames(publicUrl?.startsWith('https:') ?? false);
  const origin = (c: Context) => publicUrl ?? new URL(c.req.url).origin;
  const ownPage = (c: Context) => {
    if (!fromOwnPage(c, origin(c))) throw forbidden('Changes must come from Setpoint\'s own page.', 'cross_origin');
  };
  const rp = (c: Context) => relyingParty(publicUrl, c.req.header('origin'), production);
  const presentCommand = (row: CommandRow) => commandPresenter(store)(row);
  const signIn = (c: Context, generation: number, method: Session['method'], passwordAt: string | null) => {
    const secret = createSession(store, {generation, method, passwordAt});
    if (!secret) throw conflict('security_changed', 'Security settings changed; sign in again.');
    setSessionCookie(c, cookies, secret);
    clearCookie(c, cookies, 'pending');
  };

  app.onError((error, c) => {
    if (error instanceof SetpointError) return c.json(errorBody(error.code, error.message, error.details), error.status as ContentfulStatusCode);
    if (error instanceof HTTPException) return c.json(errorBody('http', error.message || 'Request refused.'), error.status);
    console.error(`${c.req.method} ${c.req.path}`, error);
    return c.json(errorBody('internal', 'Something went wrong; the server log has the details.'), 500);
  });

  // For Docker's healthcheck: whether the database answers, without a session.
  app.get('/health', c => {
    c.header('Cache-Control', 'no-store');
    try {
      store.sqlite.prepare('SELECT 1').get();
      return c.json({ok: true});
    } catch (error) {
      console.error(error);
      return c.json({ok: false}, 503);
    }
  });

  // An .ics file is read up to twice the most an import takes, so one over it is refused in
  // readIcs's words ("over 2 MB") rather than by the body limit.
  const normalLimit = bodyLimit({maxSize: 1024 * 1024});
  const fileLimit = bodyLimit({maxSize: 2 * ICS_MAX_BYTES});
  // A draft's file is read up to the most a message carries, and a little over, so one past it is
  // refused in the limit's words rather than the body limit's.
  const draftFileLimit = bodyLimit({maxSize: ATTACHMENTS_MAX_BYTES + 1024 * 1024, onError: c => c.json(errorBody('too_large', 'Attachments can total 25 MB, and this file alone is over it.'), 413)});
  const limitFor = (c: Context) => (c.req.path === ICS_READ_PATH ? fileLimit : c.req.method === 'POST' && DRAFT_FILE_PATH.test(c.req.path) ? draftFileLimit : normalLimit);
  app.use('/api/*', (c, next) => limitFor(c)(c, next), async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });

  // ---- Sign-in: no session needed ----

  app.get('/api/auth/status', c => {
    const owner = getOwner(store);
    const secret = readCookie(c, cookies.session);
    return c.json({
      claimed: owner !== null, signed_in: secret ? findSession(store, secret, false) !== null : false,
      passkeys: owner ? passkeyCount(store) > 0 : false, auth_mode: owner?.authMode ?? 'password_or_passkey',
    } satisfies AuthStatusOut);
  });

  app.post('/api/auth/claim', async c => {
    ownPage(c);
    const input = parse(claimInput, await body(c));
    const {owner, recoveryCodes} = await claimOwner(store, input.setup_token, input.password, bcryptCost);
    signIn(c, owner.securityGeneration, 'claim', isoNow(store));
    return c.json({recovery_codes: recoveryCodes} satisfies RecoveryCodesOut, 201);
  });

  app.post('/api/auth/sign-in', async c => {
    ownPage(c);
    const input = parse(signInInput, await body(c));
    const owner = getOwner(store);
    if (!owner) throw unauthorized('Wrong password.', 'wrong_password');
    sweepExpiredAuth(store);
    reservePasswordAttempt(store);
    if (!await passwordMatches(owner, input.password)) throw unauthorized('Wrong password.', 'wrong_password');
    const now = isoNow(store);
    const outcome = passwordSignInOutcome(owner.authMode, passkeyCount(store));
    if (outcome === 'misconfigured') throw conflict('no_passkey', 'Strict sign-in needs a registered passkey.');
    if (outcome === 'passkey_required') {
      const pending = startPendingSignIn(store, now, owner.securityGeneration);
      if (!pending) throw conflict('security_changed', 'Security settings changed; sign in again.');
      setPendingCookie(c, cookies, pending);
      clearCookie(c, cookies, 'session');
      return c.json({signed_in: false, passkey_required: true} satisfies SignInOut);
    }
    signIn(c, owner.securityGeneration, 'password', now);
    return c.json({signed_in: true, passkey_required: false} satisfies SignInOut);
  });

  app.post('/api/auth/passkey/options', async c => {
    ownPage(c);
    const {options, pendingSecret} = await passkeySignInOptions(store, rp(c), readCookie(c, cookies.pending));
    if (pendingSecret) setPendingCookie(c, cookies, pendingSecret);
    return c.json(options);
  });

  app.post('/api/auth/passkey/verify', async c => {
    ownPage(c);
    const input = parse(passkeyResponseInput, await body(c));
    const {generation, passwordAt} = await verifyPasskeySignIn(store, rp(c), readCookie(c, cookies.pending), input.response);
    signIn(c, generation, passwordAt ? 'password_plus_passkey' : 'passkey', passwordAt);
    return c.json({signed_in: true, passkey_required: false} satisfies SignInOut);
  });

  app.post('/api/auth/passkey/cancel', c => {
    ownPage(c);
    cancelPendingSignIn(store, readCookie(c, cookies.pending));
    clearCookie(c, cookies, 'pending');
    return c.body(null, 204);
  });

  app.post('/api/auth/recover', async c => {
    ownPage(c);
    const input = parse(recoverInput, await body(c));
    const {generation, codes} = await recover(store, input.recovery_code, input.new_password, bcryptCost);
    signIn(c, generation, 'recovery', null);
    return c.json({recovery_codes: codes} satisfies RecoveryCodesOut);
  });

  app.post('/api/auth/sign-out', c => {
    ownPage(c);
    const secret = readCookie(c, cookies.session);
    if (secret) endSession(store, secret);
    cancelPendingSignIn(store, readCookie(c, cookies.pending));
    clearCookie(c, cookies, 'session');
    clearCookie(c, cookies, 'pending');
    // The email bodies the browser kept go with the session.
    c.header('Clear-Site-Data', '"cache"');
    return c.body(null, 204);
  });

  // ---- Google's return from Connect Gmail: a cross-site redirect, so no session cookie comes
  // with it. The sealed state is its proof (src/providers/gmail/connect.ts) ----

  const gmailRedirect = (c: Context) => `${origin(c)}${GMAIL_CALLBACK_PATH}`;
  const checkConnected = (connected: Connected) => {
    for (const sourceId of connected.sourceIds) engine?.checkNow(sourceId);
  };
  app.get(GMAIL_CALLBACK_PATH, async c => {
    const gmail = connectors.gmail;
    if (!gmail) return c.redirect('/settings/accounts?error=google_not_configured', 302);
    try {
      const connected = await gmail.complete(gmailRedirect(c), {code: c.req.query('code'), state: c.req.query('state'), error: c.req.query('error')});
      checkConnected(connected);
      return c.redirect(`/settings/accounts?connected=${connected.accountId}`, 302);
    } catch (error) {
      const code = error instanceof SetpointError ? error.code : 'google_refused';
      console.error(`Connect Gmail failed (${code}):`, error instanceof Error ? error.message : error);
      return c.redirect(`/settings/accounts?error=${encodeURIComponent(code)}`, 302);
    }
  });

  // ---- Providers calling back: no session ----

  // Google Calendar's watch notifications: bodyless, authenticated by the channel's token. The sync
  // is queued durably before Google hears 204. If it can't be, Google hears 503 and sends again.
  app.post('/api/calendar/push', c => {
    const admitted = admitPush(store, c.req.raw.headers, providers.calendarApi ?? CALENDAR_API);
    if (!admitted.accepted) return c.body(null, 401);
    try {
      wakeSync(store, admitted.sourceId);
    } catch (error) {
      console.error('Calendar push', error);
      return c.body(null, 503);
    }
    return c.body(null, 204);
  });

  // Todoist's webhook: signed with the app's client secret, and only ever wakes a sync (the payload
  // isn't read). The sync is queued durably before Todoist hears 200. If it can't be, Todoist hears
  // 503 and retries. The body is never logged.
  app.post(WEBHOOK_PATH, async c => {
    const secret = providers.todoistOAuth?.client?.clientSecret;
    if (!secret) return c.body(null, 503);
    const raw = Buffer.from(await c.req.arrayBuffer());
    try {
      const outcome = admitTodoistWebhook(store, raw, c.req.raw.headers, secret);
      if (outcome === 'unauthorized') return c.body(null, 401);
      if (outcome === 'bad_request') return c.body(null, 400);
    } catch (error) {
      console.error('Todoist webhook', error);
      return c.body(null, 503);
    }
    return c.body(null, 200);
  });

  // Todoist's redirect back from its consent page. Setpoint's session cookie is SameSite=Strict, so
  // it isn't sent on this cross-site redirect: the state (single use, bound to the browser by its
  // own Lax cookie) is what authorizes it. The page then moves on by itself, a same-site navigation
  // that carries the session again.
  app.get(TODOIST_CALLBACK_PATH, async c => {
    const bind = readCookie(c, BIND_COOKIE);
    deleteCookie(c, BIND_COOKIE, {path: TODOIST_CALLBACK_PATH, secure: cookies.secure});
    const page = (status: 200 | 400, title: string, to: string) => {
      c.header('Content-Security-Policy', "default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      c.header('Referrer-Policy', 'no-referrer');
      return c.html(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${to}"><title>${title}</title><p>${title} <a href="${to}">Continue</a></p>`, status);
    };
    try {
      if (c.req.query('error')) throw new TodoistOAuthError('Todoist sign-in was cancelled.');
      const sourceId = await completeTodoistOAuth(store, providers.todoistOAuth ?? {client: null}, {
        code: c.req.query('code') ?? null, state: c.req.query('state') ?? null, bind, redirectUri: new URL(TODOIST_CALLBACK_PATH, origin(c)).href,
      });
      enqueueJob(store, {kind: 'sync', key: `sync:${sourceId}`, sourceId});
      return page(200, 'Todoist is connected.', '/settings/accounts?todoist=1');
    } catch (error) {
      if (!(error instanceof TodoistOAuthError)) console.error('Todoist callback', error);
      return page(400, 'Todoist couldn\'t be connected. Try again from Settings › Accounts.', '/settings/accounts?todoist=0');
    }
  });

  // ---- Home Assistant: its own bearer token, not the session ----

  // Mail's state for mantel's chip, read-only: the counts, up to three attention emails and the
  // sources needing reconnect (`@setpoint/shared`'s status.ts documents what the HA integration
  // reads). Only GET takes the token. Any other method falls through to the session's rules, and
  // the token opens nothing else. The header is never logged.
  app.get('/api/status/ha', c => {
    if (!haTokenMatches(store, c.req.header('authorization'))) {
      c.header('WWW-Authenticate', 'Bearer realm="setpoint"');
      return c.json(errorBody('unauthorized', 'Send Setpoint\'s Home Assistant token as a bearer token.'), 401);
    }
    return c.json(haStatus(store, origin(c)) satisfies HaStatusOut);
  });

  // ---- A removable module's own-token routes: whatever server.ts passes ----

  for (const module of tokenRoutes) app.route('/api', module);

  // ---- Everything else needs the session ----

  app.use('/api/*', async (c: Context<Env>, next: Next) => {
    const secret = readCookie(c, cookies.session);
    const session = secret ? findSession(store, secret) : null;
    if (!secret || !session) return c.json(errorBody('unauthorized', 'Sign in to Setpoint.'), 401);
    if (!['GET', 'HEAD'].includes(c.req.method)) ownPage(c);
    if (session.renewed) setSessionCookie(c, cookies, secret);
    c.set('session', session);
    c.set('alive', () => findSession(store, secret, false) !== null);
    await next();
  });

  app.get('/api/me', c => {
    const session = c.get('session');
    return c.json({
      method: session.method, time_zone: store.timeZone, now: isoNow(store), recent_password: hasRecentPassword(store, session),
    } satisfies MeOut);
  });

  // ---- Settings › Security (src/api/security.ts) ----

  app.route('/api', securityApi(store, {cookies, rp, bcryptCost}));

  // ---- Mail, drafts and sending, and trusted domains (src/api/mail.ts) ----

  app.route('/api', mailApi(store, {engine, drafting, draftFiles}));
  // Triage's health, pattern prompts, rules and Settings › AI (src/api/triage.ts).
  app.route('/api', triageApi(store));

  // ---- Search, Alfred and proposals, and Places (src/api/search.ts) ----

  app.route('/api', searchApi(store, {engine, alfred, prefill, reading, providers, production}));

  // ---- Todoist and Calendar (src/api/calendar.ts) ----

  app.route('/api', calendarApi(store, {cookies, providers}));

  // ---- News: its pages, Settings › News and stories seen (src/api/news.ts) ----

  app.route('/api', newsApi(store, {...news, origin}));

  // ---- A removable module's routes (Jobs, after News): whatever server.ts passes ----

  for (const module of routes) app.route('/api', module);

  // ---- Commands: Try again and Move back ----

  app.get('/api/commands', c => {
    const input = parse(commandListInput, c.req.query());
    const rows = input.active === false ? store.db.select().from(t.commands).all() : activeCommands(store);
    return c.json(rows.map(presentCommand));
  });
  app.post('/api/commands/:id/retry', c => c.json(presentCommand(retryCommand(store, id(c.req.param('id'))))));
  app.post('/api/commands/:id/move-back', c => c.json(presentCommand(moveBackCommand(store, id(c.req.param('id'))))));
  app.get('/api/commands/:id', c => c.json(presentCommand(getCommand(store, id(c.req.param('id'))))));

  // ---- Accounts, sources, settings, secrets, notifications ----

  app.get('/api/accounts', c => c.json(accountList(store)));
  app.patch('/api/accounts/:id', async c => c.json(updateAccount(store, id(c.req.param('id')), parse(accountUpdateInput, await body(c)))));
  app.put('/api/accounts/order', async c => c.json(reorderAccounts(store, parse(accountOrderInput, await body(c)).account_ids)));
  app.post('/api/accounts/gmail/authorize', async c => {
    const input = parse(gmailAuthorizeInput, await body(c));
    if (!connectors.gmail) throw new SetpointError('google_not_configured', 'Google sign-in isn\'t set up on this Setpoint (SETPOINT_GOOGLE_CLIENT_ID).', 503);
    let account: {id: number; address: string} | null = null;
    if (input.account_id !== undefined) {
      const row = store.db.select().from(t.accounts).where(eq(t.accounts.id, input.account_id)).get();
      if (!row || row.provider !== 'gmail') throw invalid('That isn\'t a Gmail account.');
      account = {id: row.id, address: row.address};
    }
    return c.json({url: connectors.gmail.authorizeUrl(gmailRedirect(c), account)} satisfies GmailAuthorizeOut);
  });
  app.post('/api/accounts/icloud', async c => {
    const input = parse(icloudConnectInput, await body(c));
    if (!connectors.icloud) throw new SetpointError('icloud_not_configured', 'iCloud isn\'t available on this Setpoint.', 503);
    const connected = await connectors.icloud.connect(input);
    checkConnected(connected);
    return c.json(accountList(store).find(account => account.id === connected.accountId)! satisfies AccountOut, connected.created ? 201 : 200);
  });
  app.get('/api/sources', c => c.json(sourceList(store)));
  app.put('/api/sources/:id/credentials', async c => {
    const sourceId = id(c.req.param('id'));
    writeSourceCredentials(store, sourceId, parse(credentialsInput, await body(c)));
    engine?.checkNow(sourceId);
    noteLive(store, {type: 'health', sources: [sourceId]});
    return c.body(null, 204);
  });
  app.post('/api/sources/:id/check', c => {
    engine?.checkNow(id(c.req.param('id')));
    return c.body(null, 204);
  });
  app.get('/api/settings', c => c.json(getSettings(store)));
  app.patch('/api/settings', async c => {
    const patch = parse(settingsPatchInput, await body(c));
    const settings = updateSettings(store, patch);
    if (patch.ai) triage?.configurationChanged();
    if (patch.news) newsSort?.configurationChanged();
    return c.json(settings);
  });
  const secretName = (value: string): SecretName => {
    if (!(SECRET_NAMES as readonly string[]).includes(value)) throw invalid(`No secret called ${value}.`);
    return value as SecretName;
  };
  app.get('/api/secrets', c => c.json(listSecrets(store)));
  app.put('/api/secrets/:name', async c => {
    setSecret(store, secretName(c.req.param('name')), parse(secretInput, await body(c)).value);
    if (isAiKeySecret(c.req.param('name'))) {
      triage?.configurationChanged();
      newsSort?.configurationChanged();
    }
    return c.body(null, 204);
  });
  app.delete('/api/secrets/:name', c => {
    deleteSecret(store, secretName(c.req.param('name')));
    if (isAiKeySecret(c.req.param('name'))) {
      triage?.configurationChanged();
      newsSort?.configurationChanged();
    }
    return c.body(null, 204);
  });
  app.get('/api/notifications/status', c => {
    if (!notifier) throw new SetpointError('unavailable', 'Notifications are off in this Setpoint.', 503);
    return c.json(notifier.status());
  });
  app.post('/api/notifications/test', async c => {
    if (!notifier) throw new SetpointError('unavailable', 'Notifications are off in this Setpoint.', 503);
    return c.json(await notifier.sendTest());
  });

  // ---- The live stream ----

  // Server-Sent Events of LiveEvents. `ready` starts each connection with the id to resume from.
  // `mail`, `items`, `health` and `news` name what changed. `resync` means refetch everything. A
  // comment and a `ping` every 25 s keep it open. It ends once the session
  // stops working, or the server stops.
  let streams = 0;
  app.get('/api/events', c => {
    const feed = store.live;
    if (!feed) throw new SetpointError('unavailable', 'Live updates are off in this Setpoint.', 503);
    if (feed.closed) throw new SetpointError('unavailable', 'Setpoint is stopping.', 503);
    if (streams >= MAX_STREAMS) throw new SetpointError('too_many_streams', `Setpoint keeps at most ${MAX_STREAMS} live streams open.`, 503);
    const alive = c.get('alive');
    const lastId = c.req.header('last-event-id') ?? c.req.query('last_event_id');
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async stream => {
      streams += 1;
      let finish = () => {};
      const finished = new Promise<void>(resolve => (finish = resolve));
      let chain = Promise.resolve();
      const send = (message: SSEMessage | string) => {
        chain = chain.then(async () => {
          if (typeof message === 'string') await stream.write(message);
          else await stream.writeSSE(message);
        }).catch(finish);
      };
      const toMessage = (event: Exclude<FeedEvent, {type: 'closed'}>): SSEMessage =>
        event.type === 'live' ? {event: event.event.type, id: event.id, data: JSON.stringify(event.event)} : {event: 'resync', id: event.id, data: '{}'};
      const unsubscribe = feed.subscribe(event => (event.type === 'closed' ? finish() : send(toMessage(event))));
      const missed = lastId === undefined ? [] : feed.since(lastId);
      if (missed === null) send({event: 'resync', id: feed.lastId, data: '{}', retry: 3000});
      else for (const event of missed) send(toMessage(event));
      send({event: 'ready', id: feed.lastId, data: JSON.stringify({last_id: feed.lastId} satisfies ReadyOut), retry: 3000});
      const timer = setInterval(() => {
        if (!alive()) return finish();
        send(': keep-alive\n\n');
        send({event: 'ping', data: '{}'});
      }, keepAliveMs);
      stream.onAbort(finish);
      try {
        await finished;
      } finally {
        clearInterval(timer);
        unsubscribe();
        streams -= 1;
      }
      await chain;
    });
  });

  app.all('/api/*', c => c.json(errorBody('not_found', `No API route ${c.req.method} ${c.req.path}.`), 404));

  if (webDir && fs.existsSync(path.join(webDir, 'index.html'))) {
    const secure = async (c: Context, next: Next) => {
      await next();
      c.header('Content-Security-Policy', WEB_POLICY);
      c.header('X-Frame-Options', 'DENY');
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('Referrer-Policy', 'same-origin');
    };
    const cache = (value: string) => async (c: Context, next: Next) => {
      c.header('Cache-Control', value);
      await next();
    };
    // Vite's hashed assets never change. A missing one is a 404, not the app.
    app.get('/assets/*', secure, cache('public, max-age=31536000, immutable'), serveStatic({root: webDir}));
    app.get('/assets/*', c => c.text('Not found', 404));
    // Any other page is a file, or else one of the single-page app's routes.
    app.get('/*', secure, cache('no-cache'), serveStatic({root: webDir}), serveStatic({root: webDir, path: 'index.html'}));
  }
  return app;
}
