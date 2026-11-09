// A written rule's delayed trash (DESIGN.md #347, D494), run the way the reminders are: a pass every
// minute. Each pass:
// 1. tries again every delayed trash the provider refused, which failed in place;
// 2. trashes each email whose due time has come, unless it's pinned or protected, through the
//    user's own Trash command. One the command can't take yet (the email has a change of its own
//    waiting) keeps its due time for the next pass.
// The due time is stored on the email, so a restart catches up on everything that fell due while
// the server was down, with no grace window: trash isn't time-sensitive as a reminder is.
import {and, eq, isNull, lte, sql} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {ruleTrashDue} from '../commands/mail.ts';
import {retryCommand} from '../commands/index.ts';
import {SetpointError} from '../errors.ts';
import {isoNow} from '../store.ts';
import type {Store} from '../store.ts';

export class RuleTrashScheduler {
  private readonly store: Store;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(options: {store: Store}) {
    this.store = options.store;
  }

  start(everyMs = 60_000) {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), everyMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass; a pass already running is joined rather than doubled. */
  tick(): Promise<void> {
    this.running ??= this.pass().catch(error => console.error('Rule trash', error)).finally(() => (this.running = null));
    return this.running;
  }

  private async pass() {
    const {store} = this;
    const refused = store.db.select({id: t.commands.id}).from(t.commands)
      .where(and(eq(t.commands.kind, 'trash'), eq(t.commands.state, 'failed'), sql`json_extract(${t.commands.payload}, '$.delayed') = 1`)).all();
    for (const {id} of refused) retryCommand(store, id);

    const due = store.db.select({id: t.messages.id}).from(t.messages)
      .where(and(lte(t.messages.trashDueAt, isoNow(store)), isNull(t.messages.trashedAt), isNull(t.messages.pinnedAt), eq(t.messages.protected, false))).all();
    for (const {id} of due) {
      try {
        ruleTrashDue(store, id);
      } catch (error) {
        // Its own change is still waiting or failed: the due time stays, for the next pass.
        if (!(error instanceof SetpointError && error.code.startsWith('command_'))) throw error;
      }
    }
  }
}
