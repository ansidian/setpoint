// The typed live events (BRIEF.md › Decided elsewhere): one stream of `mail`, `items`, `health`,
// `news` and `jobs` events, each naming what changed. A write notes what it touched while its transaction runs,
// and the event goes out only once the outermost transaction commits, so a refused write sends
// nothing (darma's change feed). Events in one transaction merge into one per type.
import {randomBytes} from 'node:crypto';
import {NEWS_SECTIONS} from '@setpoint/shared';
import type {LiveEvent} from '@setpoint/shared';

export type FeedEvent =
  | {type: 'live'; id: string; event: LiveEvent}
  | {type: 'resync'; id: string}
  // The server is stopping; streams end so it can.
  | {type: 'closed'};
type Kept = Exclude<FeedEvent, {type: 'closed'}>;

// Enough for a reconnect after a sleep or a dropped connection; older ids get `resync`.
const KEEP = 1000;

const union = (a: number[], b: number[]) => [...new Set([...a, ...b])].sort((x, y) => x - y);

function merge(a: LiveEvent, b: LiveEvent): LiveEvent {
  if (a.type === 'mail' && b.type === 'mail') return {type: 'mail', messages: union(a.messages, b.messages), accounts: union(a.accounts, b.accounts), commands: union(a.commands, b.commands)};
  if (a.type === 'items' && b.type === 'items') return {type: 'items', items: union(a.items, b.items), calendars: union(a.calendars, b.calendars), commands: union(a.commands, b.commands)};
  if (a.type === 'health' && b.type === 'health') return {type: 'health', sources: union(a.sources, b.sources)};
  if (a.type === 'news' && b.type === 'news') {
    return {type: 'news', stories: union(a.stories, b.stories), sections: NEWS_SECTIONS.filter(section => a.sections.includes(section) || b.sections.includes(section)), sources: union(a.sources, b.sources)};
  }
  if (a.type === 'jobs' && b.type === 'jobs') return {type: 'jobs', applications: union(a.applications, b.applications), needs_you: union(a.needs_you, b.needs_you)};
  throw new Error('Only events of one type merge.');
}

export class LiveFeed {
  // Ids carry the process's start, so a reconnect after a restart gets `resync`.
  private readonly boot = randomBytes(4).toString('hex');
  private seq = 0;
  private recent: Kept[] = [];
  private readonly listeners = new Set<(event: FeedEvent) => void>();
  private pending = new Map<LiveEvent['type'], LiveEvent>();
  closed = false;

  get lastId(): string {
    return `${this.boot}-${this.seq}`;
  }

  note(event: LiveEvent) {
    const earlier = this.pending.get(event.type);
    this.pending.set(event.type, earlier ? merge(earlier, event) : event);
  }

  /** After the outermost transaction commits. */
  flush() {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const event of pending) this.emit(id => ({type: 'live', id, event}));
  }

  /** The transaction rolled back. */
  discard() {
    this.pending.clear();
  }

  resync() {
    this.emit(id => ({type: 'resync', id}));
  }

  /** The events after `lastId`, or null when this process can't account for it (the stream then sends `resync`). */
  since(lastId: string): Kept[] | null {
    const match = /^([0-9a-f]{8})-(\d+)$/.exec(lastId);
    if (!match || match[1] !== this.boot) return null;
    const seq = Number(match[2]);
    if (seq > this.seq) return null;
    if (seq === this.seq) return [];
    const oldest = this.seq - this.recent.length + 1;
    if (seq + 1 < oldest) return null;
    return this.recent.slice(seq + 1 - oldest);
  }

  subscribe(listener: (event: FeedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {
    this.closed = true;
    for (const listener of [...this.listeners]) listener({type: 'closed'});
    this.listeners.clear();
  }

  private emit(make: (id: string) => Kept) {
    this.seq += 1;
    const event = make(this.lastId);
    this.recent.push(event);
    if (this.recent.length > KEEP) this.recent.shift();
    for (const listener of this.listeners) {
      // A broken stream must not make a committed write look failed.
      try {
        listener(event);
      } catch (error) {
        console.error(error);
      }
    }
  }
}
