// A test world for triage: the seed's accounts, the triage worker on the sync engine with its model
// endpoints on the fake (tests/fakeModels.ts), and helpers to deliver mail and run jobs to the end.
import {and, eq, inArray, lte} from 'drizzle-orm';
import * as t from '../src/db/schema.ts';
import {FIXTURES} from '../src/dev/fixtures/index.ts';
import type {Notifier} from '../src/notify/index.ts';
import type {AiEndpoints} from '../src/providers/ai/index.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import type {FetchedMessage} from '../src/sync/mailMirror.ts';
import {Adapters} from '../src/sync/registry.ts';
import {triageStatus} from '../src/triage/health.ts';
import {HistoryExtractor} from '../src/triage/history.ts';
import {TriageWorker} from '../src/triage/worker.ts';
import {world} from './helpers.ts';

export function triageWorld(endpoints: AiEndpoints, {timeoutMs = 2000, fixtures = [], notifier}: {timeoutMs?: number; fixtures?: string[]; notifier?: (store: ReturnType<typeof world>['store']) => Notifier} = {}) {
  const w = world({seed: true});
  // Board fixtures on the seed (new-digest: board 09's four digests cleared unopened, a real prompt's run).
  for (const name of fixtures) FIXTURES[name]!.apply({sqlite: w.store.sqlite, db: w.store.db});
  const worker = new TriageWorker({store: w.store, endpoints, timeoutMs, notifier: notifier?.(w.store)});
  const history = new HistoryExtractor({store: w.store, endpoints, timeoutMs});
  const engine = new SyncEngine({store: w.store, adapters: new Adapters(), workers: [worker, history]});
  const dueTriage = () => w.store.db.select({id: t.jobs.id}).from(t.jobs)
    .where(and(inArray(t.jobs.kind, ['triage', 'extract']), eq(t.jobs.state, 'queued'), lte(t.jobs.runAt, w.store.now().toISOString()))).all().length;
  return {
    ...w, worker, history, engine,
    /** Runs ticks until no triage job is due. */
    async drain() {
      for (let round = 0; round < 50; round += 1) {
        await engine.tick();
        await engine.settled();
        if (!dueTriage()) return;
      }
      throw new Error('Triage jobs kept coming');
    },
    accountId: (label: string) => w.store.db.select().from(t.accounts).where(eq(t.accounts.label, label)).get()!.id,
    message: (id: number) => w.store.db.select().from(t.messages).where(eq(t.messages.id, id)).get()!,
    job: (id: number) => w.store.db.select().from(t.jobs).where(eq(t.jobs.messageId, id)).all().at(-1),
    status: () => triageStatus(w.store),
    fetched: (overrides: Partial<FetchedMessage> = {}): FetchedMessage => {
      const bodyText = overrides.bodyText ?? 'Hello.';
      return {
        providerId: `p-${Math.random().toString(36).slice(2)}`, threadId: 'thread', rfc822Id: null, fromName: 'Sender', fromAddress: 'sender@example.com',
        subject: 'Hello', snippet: bodyText.slice(0, 120), bodyText, bodyHtml: null, receivedAt: '2026-10-07T16:00:00.000Z', senderAuth: null,
        attachments: [], unread: true, trashed: false, archived: false, ...overrides,
      };
    },
  };
}
