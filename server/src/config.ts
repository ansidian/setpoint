// Runtime settings, from the environment. Setpoint binds to 127.0.0.1 (behind Nginx) unless
// SETPOINT_HOST says otherwise, as a container with a published port needs.
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export interface Config {
  // SETPOINT_HOST: the address to listen on. 127.0.0.1 by default; 0.0.0.0 inside a container whose
  // port the host publishes on its own loopback (OPERATIONS.md).
  host: string;
  port: number;
  dataDir: string;
  databasePath: string;
  // The built web app, served from the same origin when present.
  webDir: string;
  // Local days (All's headings, the calendar) are counted in this zone.
  timeZone: string;
  // Setpoint's own origin (SETPOINT_PUBLIC_URL): an https one makes the session cookie Secure, and
  // it's the passkeys' relying party and the base of ntfy's click links.
  publicUrl: string | null;
  // SETPOINT_WEBHOOK_ORIGIN: the https origin Google Calendar's watch channels are told to post to,
  // when it isn't the public URL's (v1's EA_WEBHOOK_ORIGIN: pages on a private name, webhooks on a
  // public one). Null uses the public URL, if that's https.
  webhookOrigin: string | null;
  production: boolean;
  // `seed` runs the clock from the seed's moment (SEED_NOW) onwards, for `npm run dev`; `frozen`
  // holds it at SEED_NOW, so the browser checks' screenshots don't depend on how long they take.
  clock: 'real' | 'seed' | 'frozen';
  // SETPOINT_DEV_AI_URL: every model call (triage, history, Alfred) goes to this fake on the loopback
  // instead of Anthropic or OpenAI, so the browser checks can show Alfred answering. Development only.
  devAiUrl: string | null;
  // SETPOINT_DEV_PROVIDER_HOLD: a file; while it's there, the dev provider holds every change it's
  // sent rather than confirming it, so a browser check decides when the provider confirms.
  // Development only.
  devProviderHold: string | null;
  // The one Google OAuth client, for Connect Gmail's consent, which Google Calendar rides too
  // (SETPOINT_GOOGLE_CLIENT_ID and _SECRET); null leaves Gmail and Calendar unconnectable.
  google: {clientId: string; clientSecret: string} | null;
  // Gmail push: the topic users.watch publishes to, v2's own pull subscription on it, and the
  // service account that pulls (SETPOINT_GMAIL_PUBSUB_TOPIC, _SUBSCRIPTION and
  // SETPOINT_GOOGLE_SERVICE_ACCOUNT_FILE). Null polls Gmail every 2 minutes instead.
  gmailPubSub: {topic: string; subscription: string; serviceAccountFile: string} | null;
  // Todoist's OAuth app (SETPOINT_TODOIST_CLIENT_ID and _SECRET); its callback is
  // /api/ea/accounts/todoist/callback. Null leaves Todoist unconnectable.
  todoistClient: {clientId: string; clientSecret: string} | null;
}

function todoistConfig(env: NodeJS.ProcessEnv): Pick<Config, 'todoistClient'> {
  const clientId = env.SETPOINT_TODOIST_CLIENT_ID?.trim();
  const clientSecret = env.SETPOINT_TODOIST_CLIENT_SECRET?.trim();
  if (Boolean(clientId) !== Boolean(clientSecret)) throw new Error('Set both SETPOINT_TODOIST_CLIENT_ID and SETPOINT_TODOIST_CLIENT_SECRET, or neither.');
  return {todoistClient: clientId && clientSecret ? {clientId, clientSecret} : null};
}

const TOPIC = /^projects\/[A-Za-z0-9._:-]+\/topics\/[A-Za-z0-9._~+%-]+$/;
const SUBSCRIPTION = /^projects\/[a-z][a-z0-9-]+\/subscriptions\/[A-Za-z][A-Za-z0-9._~+%-]+$/;

function googleConfig(env: NodeJS.ProcessEnv): Pick<Config, 'google' | 'gmailPubSub'> {
  const clientId = env.SETPOINT_GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.SETPOINT_GOOGLE_CLIENT_SECRET?.trim();
  if (Boolean(clientId) !== Boolean(clientSecret)) throw new Error('Set both SETPOINT_GOOGLE_CLIENT_ID and SETPOINT_GOOGLE_CLIENT_SECRET, or neither.');
  const topic = env.SETPOINT_GMAIL_PUBSUB_TOPIC?.trim();
  const subscription = env.SETPOINT_GMAIL_PUBSUB_SUBSCRIPTION?.trim();
  const serviceAccountFile = env.SETPOINT_GOOGLE_SERVICE_ACCOUNT_FILE?.trim();
  const pubsub = [topic, subscription, serviceAccountFile].filter(Boolean).length;
  if (pubsub && pubsub < 3) throw new Error('Gmail push needs SETPOINT_GMAIL_PUBSUB_TOPIC, SETPOINT_GMAIL_PUBSUB_SUBSCRIPTION and SETPOINT_GOOGLE_SERVICE_ACCOUNT_FILE together.');
  if (topic && !TOPIC.test(topic)) throw new Error('SETPOINT_GMAIL_PUBSUB_TOPIC must be projects/<project>/topics/<topic>.');
  if (subscription && !SUBSCRIPTION.test(subscription)) throw new Error('SETPOINT_GMAIL_PUBSUB_SUBSCRIPTION must be projects/<project>/subscriptions/<subscription>.');
  if (pubsub && !clientId) throw new Error('Gmail push needs the Google client too (SETPOINT_GOOGLE_CLIENT_ID).');
  return {
    google: clientId && clientSecret ? {clientId, clientSecret} : null,
    gmailPubSub: topic && subscription && serviceAccountFile ? {topic, subscription, serviceAccountFile: path.resolve(serviceAccountFile)} : null,
  };
}

/** An https origin and nothing more (no path, query or credentials), or null when unset. */
function httpsOrigin(value: string | undefined, name: string): string | null {
  if (!value) return null;
  const url = URL.parse(value);
  if (!url || url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password || value.includes('?') || value.includes('#')) {
    throw new Error(`${name} must be an https origin, such as https://hooks.example.com:8443.`);
  }
  return url.origin;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const host = env.SETPOINT_HOST?.trim() || '127.0.0.1';
  const port = Number(env.SETPOINT_PORT ?? 7430);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`SETPOINT_PORT is not a port: ${env.SETPOINT_PORT}`);
  const dataDir = env.SETPOINT_DATA_DIR?.trim() ? path.resolve(env.SETPOINT_DATA_DIR) : fileURLToPath(new URL('../../data/dev', import.meta.url));
  const timeZone = env.SETPOINT_TZ ?? 'America/Los_Angeles';
  // Throws a RangeError for an unknown zone.
  new Intl.DateTimeFormat('en-CA', {timeZone});
  const webDir = env.SETPOINT_WEB_DIR ? path.resolve(env.SETPOINT_WEB_DIR) : fileURLToPath(new URL('../../web/dist', import.meta.url));
  const publicUrl = env.SETPOINT_PUBLIC_URL ? new URL(env.SETPOINT_PUBLIC_URL).origin : null;
  const webhookOrigin = httpsOrigin(env.SETPOINT_WEBHOOK_ORIGIN?.trim(), 'SETPOINT_WEBHOOK_ORIGIN');
  const production = env.NODE_ENV === 'production';
  const clock = env.SETPOINT_CLOCK === 'seed' || env.SETPOINT_CLOCK === 'frozen' ? env.SETPOINT_CLOCK : 'real';
  if (production && clock !== 'real') throw new Error(`SETPOINT_CLOCK=${clock} is for development only.`);
  const devAiUrl = env.SETPOINT_DEV_AI_URL?.trim() || null;
  if (devAiUrl && production) throw new Error('SETPOINT_DEV_AI_URL is for development only.');
  if (devAiUrl && !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(devAiUrl)) throw new Error('SETPOINT_DEV_AI_URL must be http://127.0.0.1:<port>.');
  const devProviderHold = env.SETPOINT_DEV_PROVIDER_HOLD?.trim() ? path.resolve(env.SETPOINT_DEV_PROVIDER_HOLD) : null;
  if (devProviderHold && production) throw new Error('SETPOINT_DEV_PROVIDER_HOLD is for development only.');
  return {host, port, dataDir, databasePath: path.join(dataDir, 'setpoint.sqlite'), webDir, timeZone, publicUrl, webhookOrigin, production, clock, devAiUrl, devProviderHold, ...googleConfig(env), ...todoistConfig(env)};
}
