// Starts Setpoint on 127.0.0.1 (or SETPOINT_HOST): /api, the live stream and the built web app,
// from one process, with the sync engine running beside them.
//
//   npm run dev      the seed's database (data/dev), the clock from the seed's moment, watching files
//   npm start        SETPOINT_DATA_DIR, SETPOINT_KEY_FILE, SETPOINT_PUBLIC_URL… (OPERATIONS.md)
import fs from 'node:fs';
import {serve} from '@hono/node-server';
import {createApp} from './api/app.ts';
import {ensureCalendarSources} from './calendar/sources.ts';
import {loadConfig} from './config.ts';
import {openDatabase} from './db/open.ts';
import {LiveFeed} from './live/feed.ts';
import {newsImagesDir} from './news/images.ts';
import {registerNewsSources} from './news/sources.ts';
import {NewsSortWorker} from './news/sortWorker.ts';
import {NewsWorker} from './news/worker.ts';
import {Notifier} from './notify/index.ts';
import {AI_ENDPOINTS} from './providers/ai/index.ts';
import {boardRefusals, devProvider} from './providers/dev/index.ts';
import {devDraftWriter} from './providers/dev/draft.ts';
import {googleCalendarAdapter} from './providers/gcal/index.ts';
import {GmailAdapter, gmailConnector, GmailPushPuller, readServiceAccount} from './providers/gmail/index.ts';
import {GOOGLE_ENDPOINTS} from './providers/google/auth.ts';
import {ICloudAdapter, icloudConnector} from './providers/icloud/index.ts';
import {newsAdapters, newsReader} from './providers/news/index.ts';
import {todoistAdapter} from './providers/todoist/index.ts';
import {weatherAdapter} from './providers/weather/index.ts';
import {ReminderScheduler} from './reminders/scheduler.ts';
import {RuleTrashScheduler} from './triage/ruleTrash.ts';
import {SnoozeScheduler} from './triage/snooze.ts';
import {loadKeyring} from './secrets/crypto.ts';
import {storeClock} from './store.ts';
import type {Store} from './store.ts';
import {sweepEmptyDrafts} from './sending/drafts.ts';
import {draftFilesDir, sweepDraftFiles} from './sending/files.ts';
import {SendWorker} from './sending/worker.ts';
import {SyncEngine} from './sync/engine.ts';
import {Adapters} from './sync/registry.ts';
import {MailpiecesWorker} from './mailpieces/worker.ts';
import {SearchTermsWorker} from './search/terms.ts';
import {HistoryExtractor} from './triage/history.ts';
// Jobs (after News): a module that can be removed whole (src/jobs/README.md lists its wiring points).
import {JobsReader, jobsApi, jobsTokenApi, jobsWeb, migrateJobs} from './jobs/index.ts';
import {TriageWorker} from './triage/worker.ts';

const config = loadConfig();
const {sqlite, db} = openDatabase(config.databasePath);
migrateJobs(sqlite);
const {keyring, from: keyFrom} = loadKeyring(process.env, config.dataDir);
const live = new LiveFeed();
const store: Store = {sqlite, db, timeZone: config.timeZone, ...storeClock(config.clock), live, keyring};
const notifier = new Notifier(store, {publicUrl: config.publicUrl});
// Real sources go to their providers' adapters. The dev provider serves only the seed's dev
// sources, and never in production, so the seed never reaches a provider. Gmail and Calendar share
// the one Google client (and consent).
const google = config.google ? {...config.google, endpoints: GOOGLE_ENDPOINTS} : null;
const pubsub = config.gmailPubSub
  ? {topic: config.gmailPubSub.topic, subscription: config.gmailPubSub.subscription, serviceAccount: readServiceAccount(config.gmailPubSub.serviceAccountFile)}
  : null;
const gmail = google ? new GmailAdapter({client: google, topic: pubsub?.topic ?? null}) : null;
const icloud = new ICloudAdapter();
const holdFile = config.devProviderHold;
const adapters = new Adapters({
  ...(gmail ? {gmail} : {}), icloud,
  ...(google ? {google_calendar: googleCalendarAdapter({client: google, publicUrl: config.publicUrl, webhookOrigin: config.webhookOrigin})} : {}),
  todoist: todoistAdapter(),
  weather: weatherAdapter(),
}, config.production ? null : devProvider({delayMs: 600, refuse: boardRefusals, held: holdFile ? () => fs.existsSync(holdFile) : undefined}));
// Triage runs as jobs on the same engine. With no AI key, new mail waits in Unsorted.
// Development only (config refuses it in production): every model call goes to a fake on the loopback.
const aiEndpoints = config.devAiUrl ? {anthropic: config.devAiUrl} : AI_ENDPOINTS;
// Jobs reads what triage sorts in the accounts it lists. Triage's onSorted nudges its worker.
// Its JD lookups read the hiring platforms and posting pages only in production.
const jobsReader = new JobsReader({store, endpoints: aiEndpoints, ...(config.production ? {web: jobsWeb()} : {})});
// Search terms are written for what triage has sorted.
const searchTerms = new SearchTermsWorker({store, endpoints: aiEndpoints});
const triage = new TriageWorker({store, endpoints: aiEndpoints, notifier, onSorted: () => {
  jobsReader.nudge();
  searchTerms.nudge();
}});
// And, once backfills are done and a key is set, the one-time model pass over history.
const history = new HistoryExtractor({store, endpoints: aiEndpoints});
// News: its sources read on the same engine through their adapters, each new article's page
// and image read after, its expiry, its image copies. Only production reads them, because a dev run
// on a database that isn't the seed's registers the real list too, and must never reach a real feed.
const newsImages = newsImagesDir(config.dataDir);
const news = new NewsWorker({store, imagesDir: newsImages, ...(config.production ? {adapters: newsAdapters(), reader: newsReader()} : {})});
// What News reads is sorted, grouped, written and ranked on the same engine, with the keys in
// Settings › AI. A dev run asks the loopback fake, if anything.
const newsSort = new NewsSortWorker({store, endpoints: aiEndpoints});
// Each USPS digest's scans, read from its source through the engine's adapters.
const mailpiecesWorker = new MailpiecesWorker({store, fetchSource: (sourceId, message): Promise<Buffer | null> => engine.emailSource(sourceId, message)});
// Each held send, once its Undo hold ends, through the account's adapter, with the drafts' own
// files from the data directory's draft-files/ (what no draft will take is swept at start).
const draftFiles = draftFilesDir(config.dataDir);
sweepDraftFiles(store, draftFiles, {disk: true});
// Empty drafts a closed tab or a crash left behind, untouched for a day: at start, then hourly.
sweepEmptyDrafts(store);
const emptyDrafts = setInterval(() => {
  try {
    sweepEmptyDrafts(store);
  } catch (error) {
    console.error('Empty drafts', error);
  }
}, 60 * 60_000);
emptyDrafts.unref();
const sender = new SendWorker({
  store, filesDir: draftFiles, send: (sourceId, mail) => engine.sendMail(sourceId, mail), findSent: (sourceId, query) => engine.findSent(sourceId, query),
  attachment: (sourceId, message, attachmentId) => engine.attachment(sourceId, message, attachmentId),
});
const engine: SyncEngine = new SyncEngine({store, adapters, notifier, workers: [triage, history, searchTerms, news, newsSort, jobsReader, mailpiecesWorker, sender]});
const connectors = {gmail: google ? gmailConnector(store, google, pubsub !== null) : null, icloud: icloudConnector(store, icloud)};
const reminders = new ReminderScheduler({store, notifier});
// A written rule's delayed trash: a pass every minute.
const ruleTrash = new RuleTrashScheduler({store});
// Snoozed mail's return and its notification: a pass every minute.
const snooze = new SnoozeScheduler({store, notifier});
const app = createApp({
  store, webDir: config.webDir, publicUrl: config.publicUrl, production: config.production, engine, notifier, connectors,
  providers: {todoistOAuth: {client: config.todoistClient}}, triage, alfred: {endpoints: aiEndpoints},
  // A dev run with no key and no fake model drafts with the dev provider's canned answer.
  drafting: {endpoints: aiEndpoints, canned: config.production || config.devAiUrl ? null : devDraftWriter()}, reading: {endpoints: aiEndpoints}, prefill: {endpoints: aiEndpoints}, news: {imagesDir: newsImages}, draftFiles, newsSort,
  routes: [jobsApi(store)],
  tokenRoutes: [jobsTokenApi(store)],
});
// Gmail's push: pulls Setpoint's own Pub/Sub subscription and queues each account's sync.
const puller = pubsub ? new GmailPushPuller({store, settings: pubsub, endpoints: GOOGLE_ENDPOINTS, onPush: sourceId => engine.pushed(sourceId)}) : null;

const server = serve({fetch: app.fetch, hostname: config.host, port: config.port}, info => {
  console.log(`Setpoint listening on http://${config.host}:${info.port} (data in ${config.dataDir}, key from ${keyFrom}${config.clock === 'seed' ? ', clock from the seed' : ''})`);
});
engine.start();
puller?.start();
reminders.start();
ruleTrash.start();
snooze.start();
// The weather source (Connect Gmail makes each Google account's Calendar source).
ensureCalendarSources(store);
// News's built-in sources and the data directory's local list.
registerNewsSources(store, config.dataDir);

function shutdown(signal: NodeJS.Signals) {
  console.log(`Setpoint stopping (${signal})`);
  engine.stop();
  void puller?.stop();
  void icloud.close();
  reminders.stop();
  ruleTrash.stop();
  snooze.stop();
  clearInterval(emptyDrafts);
  server.close(() => {
    sqlite.close();
    process.exit(0);
  });
  // Live streams would otherwise hold the server open.
  live.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
