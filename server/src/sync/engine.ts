// The sync engine (BRIEF.md › Decided elsewhere: one engine with provider adapters). Each tick it
// schedules every source's checks from its own interval (a poll's sync, or the sweep behind a
// push, plus push renewals), runs due jobs (checks and commands) through their adapters, records
// each check as the source's heartbeat, and sends a `health` event when a source's state changes.
// A source that needs reconnecting isn't checked until new credentials arrive, and notifies once.
// Work that isn't a source's (B3's triage) runs through a JobWorker: the engine claims its jobs
// with the rest and hands them over; the worker finishes or fails each by the same retry policy.
import type {HealthState} from '@setpoint/shared';
import {and, eq} from 'drizzle-orm';
import {confirmCommand, failCommand, getCommand} from '../commands/index.ts';
import * as t from '../db/schema.ts';
import {PROVIDER_NAMES} from '../domain/sources.ts';
import type {Notifier} from '../notify/index.ts';
import {readSourceCredentials} from '../secrets/store.ts';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import type {AdapterContext, AdapterRegistry, AttachmentBytes, SourceAdapter, SourceRow} from './adapter.ts';
import {asProviderError, ProviderError} from './errors.ts';
import {recordFailure, recordSuccess, sourceHealth} from './health.ts';
import {claimDueJobs, enqueueJob, failJob, finishJob, hasActiveJob, pruneJobs} from './jobs.ts';
import type {Job} from './jobs.ts';

/** Runs one kind of job that isn't a source's (triage), and may queue more of it each tick. */
export interface JobWorker {
  kind: Job['kind'];
  // Finishes the job or fails it (src/sync/jobs.ts) itself. `signal` aborts when the engine stops.
  run(job: Job, signal: AbortSignal): Promise<void>;
  schedule?(): void;
}

export interface EngineOptions {
  store: Store;
  adapters: AdapterRegistry;
  notifier?: Notifier | null;
  workers?: JobWorker[];
  // A check or command that takes longer has failed (transient). Five minutes by default.
  timeoutMs?: number;
}

const sweepOrSync = (source: SourceRow) => (source.syncMode === 'push' ? 'sweep' : 'sync');

export class SyncEngine {
  private readonly store: Store;
  private readonly adapters: AdapterRegistry;
  private readonly notifier: Notifier | null;
  private readonly timeoutMs: number;
  private readonly workers: Map<Job['kind'], JobWorker>;
  private readonly running = new Map<number, Promise<void>>();
  private readonly lastStates = new Map<number, HealthState>();
  private readonly stopping = new AbortController();
  private timer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private soon = false;

  constructor(options: EngineOptions) {
    this.store = options.store;
    this.adapters = options.adapters;
    this.notifier = options.notifier ?? null;
    this.timeoutMs = options.timeoutMs ?? 5 * 60_000;
    this.workers = new Map((options.workers ?? []).map(worker => [worker.kind, worker]));
  }

  start(everyMs = 1000) {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), everyMs);
    this.timer.unref();
    // A change made in Setpoint goes to its provider at once, not at the next tick (DESIGN.md #54), so a
    // quick provider confirms before the grid's spinner shows.
    this.unsubscribe = this.store.live?.subscribe(event => {
      if (event.type === 'live' && 'commands' in event.event && event.event.commands.length) this.runSoon();
    }) ?? null;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stopping.abort();
  }

  /** One round: schedule what's due, start due jobs, and announce health changes. */
  async tick() {
    this.schedule();
    this.startDue();
    this.announceHealth();
  }

  private startDue() {
    for (const job of claimDueJobs(this.store, new Set(this.running.keys()))) {
      const run = this.run(job).catch(error => console.error(`Job ${job.id} (${job.key})`, error)).finally(() => this.running.delete(job.id));
      this.running.set(job.id, run);
    }
  }

  /** Starts due jobs once the current write is done; a burst of changes makes one pass. */
  private runSoon() {
    if (this.soon || this.stopping.signal.aborted) return;
    this.soon = true;
    setImmediate(() => {
      this.soon = false;
      if (!this.stopping.signal.aborted) this.startDue();
    });
  }

  /** Waits for the jobs started so far (tests, and shutdown). */
  async settled() {
    while (this.running.size) await Promise.all([...this.running.values()]);
    this.announceHealth();
  }

  /** A provider pushed: sync that source now. */
  pushed(sourceId: number) {
    enqueueJob(this.store, {kind: 'sync', key: `sync:${sourceId}`, sourceId});
  }

  /** Settings' "check now": the source's scheduled check, now. */
  checkNow(sourceId: number) {
    const source = this.store.db.select().from(t.sources).where(eq(t.sources.id, sourceId)).get();
    if (source) enqueueJob(this.store, {kind: sweepOrSync(source), key: `${sweepOrSync(source)}:${source.id}`, sourceId: source.id});
  }

  /**
   * An attachment's bytes from its source's adapter, now (the reader's preview): a ProviderError
   * when the provider refuses, or `unavailable` when nothing serves the source.
   */
  async attachment(sourceId: number, message: {providerId: string}, attachmentId: string): Promise<AttachmentBytes | null> {
    const source = this.store.db.select().from(t.sources).where(eq(t.sources.id, sourceId)).get();
    const adapter = source ? this.adapters.adapterFor(source) : null;
    if (!source || !adapter?.attachment) throw new ProviderError('permanent', 'Nothing serves this account\'s attachments in this Setpoint.');
    if (source.needsReconnectAt) throw new ProviderError('auth', 'This account needs signing in again.');
    return this.timed(adapter.attachment(this.context(source), message, attachmentId));
  }

  private schedule() {
    pruneJobs(this.store);
    for (const worker of this.workers.values()) worker.schedule?.();
    const now = this.store.now().getTime();
    for (const source of this.store.db.select().from(t.sources).all()) {
      const adapter = this.adapters.adapterFor(source);
      if (!adapter || source.needsReconnectAt) continue;
      const kind = sweepOrSync(source);
      const key = `${kind}:${source.id}`;
      const due = !source.lastCheckAt || Date.parse(source.lastCheckAt) + source.intervalSeconds * 1000 <= now;
      if (due && !hasActiveJob(this.store, key) && !hasActiveJob(this.store, `sync:${source.id}`)) {
        enqueueJob(this.store, {kind, key, sourceId: source.id});
      }
      const renewSoon = !source.pushRenewsAt || Date.parse(source.pushRenewsAt) - source.intervalSeconds * 1000 <= now;
      if (adapter.watch && source.syncMode === 'push' && renewSoon) enqueueJob(this.store, {kind: 'push', key: `push:${source.id}`, sourceId: source.id});
    }
  }

  private announceHealth() {
    const now = isoNow(this.store);
    const changed: number[] = [];
    for (const source of this.store.db.select().from(t.sources).all()) {
      const state = sourceHealth(source, now).state;
      if (this.lastStates.get(source.id) !== state) changed.push(source.id);
      this.lastStates.set(source.id, state);
    }
    if (changed.length) noteLive(this.store, {type: 'health', sources: changed});
  }

  private context(source: SourceRow): AdapterContext {
    return {
      store: this.store, source,
      credentials: () => readSourceCredentials(this.store, source.id),
      signal: AbortSignal.any([this.stopping.signal, AbortSignal.timeout(this.timeoutMs)]),
    };
  }

  /** The adapter's promise, or a transient failure once the timeout passes. */
  private timed<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ProviderError('transient', 'The provider didn\'t answer in time.')), this.timeoutMs);
      timer.unref();
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  }

  private source(job: Job): {source: SourceRow; adapter: SourceAdapter} | null {
    if (job.sourceId === null) return null;
    const source = this.store.db.select().from(t.sources).where(eq(t.sources.id, job.sourceId)).get();
    const adapter = source ? this.adapters.adapterFor(source) : null;
    return source && adapter ? {source, adapter} : null;
  }

  private async run(job: Job) {
    if (job.kind === 'command') return this.runCommand(job);
    const worker = this.workers.get(job.kind);
    if (worker) return worker.run(job, this.stopping.signal);
    const found = this.source(job);
    if (!found) return finishJob(this.store, job.id);
    const {source, adapter} = found;
    const context = this.context(source);
    try {
      if (job.kind === 'sync') {
        const stored = this.store.db.select().from(t.syncCursors).where(and(eq(t.syncCursors.sourceId, source.id), eq(t.syncCursors.scope, ''))).get();
        const result = await this.timed(adapter.sync(context, stored?.cursor ?? null));
        if (result.cursor !== null) {
          const values = {sourceId: source.id, scope: '', cursor: result.cursor, updatedAt: isoNow(this.store)};
          this.store.db.insert(t.syncCursors).values(values).onConflictDoUpdate({target: [t.syncCursors.sourceId, t.syncCursors.scope], set: {cursor: values.cursor, updatedAt: values.updatedAt}}).run();
        }
      } else if (job.kind === 'sweep') {
        await this.timed(adapter.sweep(context));
      } else if (job.kind === 'push' && adapter.watch) {
        const {renewBy} = await this.timed(adapter.watch(context, () => this.pushed(source.id)));
        this.store.db.update(t.sources).set({pushRenewsAt: renewBy}).where(eq(t.sources.id, source.id)).run();
      }
      transaction(this.store, () => {
        recordSuccess(this.store, source.id);
        finishJob(this.store, job.id);
      });
    } catch (caught) {
      const error = asProviderError(caught);
      const beganReconnect = transaction(this.store, () => {
        const began = recordFailure(this.store, source.id, error);
        // The retry policy ends the job on refused credentials: only new ones fix that.
        failJob(this.store, job, error);
        return began;
      });
      if (beganReconnect) await this.alertReconnect(source);
    }
  }

  private async runCommand(job: Job) {
    const command = job.commandId === null ? null : getCommand(this.store, job.commandId);
    if (!command || command.state !== 'pending') return finishJob(this.store, job.id);
    const found = this.source(job);
    if (!found) {
      transaction(this.store, () => {
        failCommand(this.store, command.id, 'Setpoint has no connection to send this change through.');
        finishJob(this.store, job.id);
      });
      return;
    }
    try {
      await this.timed(found.adapter.execute(this.context(found.source), command));
      transaction(this.store, () => {
        confirmCommand(this.store, command.id);
        finishJob(this.store, job.id);
      });
    } catch (caught) {
      const error = asProviderError(caught);
      let beganReconnect = false;
      transaction(this.store, () => {
        if (error.kind === 'auth') beganReconnect = recordFailure(this.store, found.source.id, error);
        const retrying = failJob(this.store, job, error);
        // A retry keeps it pending; otherwise it fails in place with the provider's words.
        if (!retrying && getCommand(this.store, command.id).state === 'pending') failCommand(this.store, command.id, error.message);
      });
      if (beganReconnect) await this.alertReconnect(found.source);
    }
  }

  /**
   * "Business needs sign-in": one ntfy notification per reconnect (DESIGN.md › Health and states).
   * An account's sources share one sign-in (Gmail and Calendar, one Google consent), so only the
   * first of them to need reconnecting alerts; the one sign-in fixes them all.
   */
  private async alertReconnect(source: SourceRow) {
    if (!this.notifier) return;
    const fresh = this.store.db.select().from(t.sources).where(eq(t.sources.id, source.id)).get();
    if (!fresh?.needsReconnectAt) return;
    if (fresh.accountId !== null) {
      const siblings = this.store.db.select().from(t.sources).where(eq(t.sources.accountId, fresh.accountId)).all();
      const first = (row: SourceRow) => row.needsReconnectAt !== null && (row.needsReconnectAt < fresh.needsReconnectAt! || (row.needsReconnectAt === fresh.needsReconnectAt && row.id < fresh.id));
      if (siblings.some(first)) return;
    }
    const account = fresh.accountId === null ? null : this.store.db.select().from(t.accounts).where(eq(t.accounts.id, fresh.accountId)).get();
    const name = account?.label ?? PROVIDER_NAMES[fresh.provider];
    await this.notifier.notify({
      kind: 'reconnect', topic: 'reminders', title: `${name} needs sign-in`, body: `Reconnect ${name} in Settings › Accounts.`,
      link: {to: 'settings', page: 'accounts'}, dedupe: `reconnect:${fresh.id}:${fresh.needsReconnectAt}`,
    });
  }
}
