// The mail providers' configuration from the environment: Connect Gmail needs the Google client;
// Gmail push needs its topic, subscription and service account together, or Gmail is polled.
import {describe, expect, test} from 'vitest';
import {loadConfig} from '../src/config.ts';

const PUSH = {
  SETPOINT_GOOGLE_CLIENT_ID: 'id.apps.example.com', SETPOINT_GOOGLE_CLIENT_SECRET: 'secret',
  SETPOINT_GMAIL_PUBSUB_TOPIC: 'projects/setpoint-test/topics/gmail', SETPOINT_GMAIL_PUBSUB_SUBSCRIPTION: 'projects/setpoint-test/subscriptions/setpoint-v2',
  SETPOINT_GOOGLE_SERVICE_ACCOUNT_FILE: '/run/secrets/pubsub.json',
};

describe('Google configuration', () => {
  test('none: Gmail can\'t be connected, and nothing pulls', () => {
    expect(loadConfig({})).toMatchObject({google: null, gmailPubSub: null});
  });

  test('the client alone: Connect Gmail works and Gmail is polled', () => {
    expect(loadConfig({SETPOINT_GOOGLE_CLIENT_ID: PUSH.SETPOINT_GOOGLE_CLIENT_ID, SETPOINT_GOOGLE_CLIENT_SECRET: 'secret'}))
      .toMatchObject({google: {clientId: 'id.apps.example.com', clientSecret: 'secret'}, gmailPubSub: null});
  });

  test('push: all of it', () => {
    expect(loadConfig(PUSH).gmailPubSub).toEqual({
      topic: 'projects/setpoint-test/topics/gmail', subscription: 'projects/setpoint-test/subscriptions/setpoint-v2', serviceAccountFile: '/run/secrets/pubsub.json',
    });
  });

  test.each([
    [{SETPOINT_GOOGLE_CLIENT_ID: 'id'}, 'Set both SETPOINT_GOOGLE_CLIENT_ID and SETPOINT_GOOGLE_CLIENT_SECRET'],
    [{...PUSH, SETPOINT_GOOGLE_SERVICE_ACCOUNT_FILE: ''}, 'Gmail push needs SETPOINT_GMAIL_PUBSUB_TOPIC'],
    [{...PUSH, SETPOINT_GMAIL_PUBSUB_SUBSCRIPTION: 'setpoint-v2'}, 'must be projects/<project>/subscriptions/<subscription>'],
    [{...PUSH, SETPOINT_GMAIL_PUBSUB_TOPIC: 'gmail'}, 'must be projects/<project>/topics/<topic>'],
    [{...PUSH, SETPOINT_GOOGLE_CLIENT_ID: '', SETPOINT_GOOGLE_CLIENT_SECRET: ''}, 'Gmail push needs the Google client'],
  ])('refuses %j', (env, message) => {
    expect(() => loadConfig(env)).toThrow(message);
  });
});

describe('the dev model endpoint (SETPOINT_DEV_AI_URL)', () => {
  test('unset: the providers\' own endpoints', () => {
    expect(loadConfig({}).devAiUrl).toBeNull();
  });

  test('a fake on the loopback, for the browser checks', () => {
    expect(loadConfig({SETPOINT_DEV_AI_URL: 'http://127.0.0.1:41234'}).devAiUrl).toBe('http://127.0.0.1:41234');
  });

  test.each([
    [{SETPOINT_DEV_AI_URL: 'http://127.0.0.1:41234', NODE_ENV: 'production'}, 'SETPOINT_DEV_AI_URL is for development only'],
    [{SETPOINT_DEV_AI_URL: 'https://api.anthropic.com'}, 'must be http://127.0.0.1:<port>'],
    [{SETPOINT_DEV_AI_URL: 'http://127.0.0.1.example.com:80'}, 'must be http://127.0.0.1:<port>'],
    [{SETPOINT_DEV_AI_URL: 'http://localhost:41234'}, 'must be http://127.0.0.1:<port>'],
  ])('refuses %j', (env, message) => {
    expect(() => loadConfig(env)).toThrow(message);
  });
});

describe('holding the dev provider (SETPOINT_DEV_PROVIDER_HOLD)', () => {
  test('unset: it confirms on its own', () => {
    expect(loadConfig({}).devProviderHold).toBeNull();
    expect(loadConfig({SETPOINT_DEV_PROVIDER_HOLD: ' '}).devProviderHold).toBeNull();
  });

  test('a file, for the browser checks, as an absolute path', () => {
    expect(loadConfig({SETPOINT_DEV_PROVIDER_HOLD: '/tmp/setpoint-hold/hold'}).devProviderHold).toBe('/tmp/setpoint-hold/hold');
  });

  test('refused in production', () => {
    expect(() => loadConfig({SETPOINT_DEV_PROVIDER_HOLD: '/tmp/setpoint-hold/hold', NODE_ENV: 'production'})).toThrow('SETPOINT_DEV_PROVIDER_HOLD is for development only');
  });
});

describe('the address Setpoint listens on (SETPOINT_HOST)', () => {
  test('the loopback unless told otherwise, as behind Nginx on the host', () => {
    expect(loadConfig({}).host).toBe('127.0.0.1');
    expect(loadConfig({SETPOINT_HOST: ' '}).host).toBe('127.0.0.1');
  });

  test('every interface inside a container, whose port the host publishes on its own loopback', () => {
    expect(loadConfig({SETPOINT_HOST: '0.0.0.0'}).host).toBe('0.0.0.0');
  });
});

describe('where Google Calendar posts (SETPOINT_WEBHOOK_ORIGIN)', () => {
  test('unset: the public URL serves', () => {
    expect(loadConfig({SETPOINT_PUBLIC_URL: 'https://setpoint.example.com'}).webhookOrigin).toBeNull();
  });

  test.each([
    ['https://hooks.example.com:8443', 'https://hooks.example.com:8443'],
    ['https://hooks.example.com/', 'https://hooks.example.com'],
    ['https://hooks.example.com:443', 'https://hooks.example.com'],
  ])('%s is the origin %s', (value, origin) => {
    expect(loadConfig({SETPOINT_WEBHOOK_ORIGIN: value}).webhookOrigin).toBe(origin);
  });

  test.each([
    'http://hooks.example.com', 'hooks.example.com', 'https://hooks.example.com/api/calendar/push', 'https://hooks.example.com?x=1',
    'https://hooks.example.com#x', 'https://user:pass@hooks.example.com',
  ])('refuses %s', value => {
    expect(() => loadConfig({SETPOINT_WEBHOOK_ORIGIN: value})).toThrow('SETPOINT_WEBHOOK_ORIGIN must be an https origin');
  });
});
