// What the phone does to an item: delete with Undo, complete and reopen, and create and save from
// the editor sheet, each saying so in the toast. They are kept in the module, as importRun.ts keeps
// its run, so an item deleted on the Agenda stays gone while the user looks at another tab.
//
// A delete is held until its toast goes, however it goes but by Undo (its time ended, swiped away or
// replaced), as Calendar's is on the desktop: Undo keeps the item and sends nothing. A delete still
// held as the page goes away is sent then, kept alive past it. A refusal brings the item back and
// says why.
import type {CommandOut, ItemChanges, ItemCreateInput, ItemOut, RecurringScope} from '@setpoint/shared';
import {useSyncExternalStore} from 'react';
import {completeItem, createItems, deleteItem, updateItem} from '../../api/items.ts';
import {deletes, inverseOf} from '../../logic/manipulate.ts';
import type {Deleting} from '../../logic/manipulate.ts';
import {dismissToast, showToast, toastFailure} from '../toast.ts';

interface Held {
  item: Pick<ItemOut, 'id' | 'key' | 'occurrence_start' | 'title'>;
  scope: RecurringScope;
  // Sent and waiting for the server, which still lists the item until it has the delete.
  sent: boolean;
}

// Items off the phone's lists: deletes held by their toast or on their way, and tasks whose
// completion or reopening is on its way, drawn as they will be.
let held: Held[] = [];
let ticking: ReadonlyMap<string, boolean> = new Map();
/** Whether a delete held or on its way takes `item` off the lists: the occurrence, every later one (This and following) or the series (All). */
type Gone = (item: ItemOut) => boolean;
const goneBy = (entries: Deleting[]): Gone => item => entries.some(entry => deletes(entry, item));
let state: {gone: Gone; ticking: ReadonlyMap<string, boolean>} = {gone: goneBy([]), ticking};
const listeners = new Set<() => void>();
const changed = () => {
  state = {gone: goneBy(held.map(({item, scope}) => ({id: item.id, scope, occurrence_start: item.occurrence_start}))), ticking};
  listeners.forEach(listener => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Whether an item is deleted here and not yet gone from the server's lists, and the tasks being checked or reopened (key → done). */
export const usePhoneChanges = () => useSyncExternalStore(subscribe, () => state);

const sends = new Map<Held, (keepalive?: boolean) => void>();
window.addEventListener('pagehide', () => [...sends.values()].forEach(send => send(true)));

/** Takes the item off the phone's lists now and says so with Undo. The delete goes once the toast does. */
export function deleteWithUndo(item: ItemOut, scope: RecurringScope = 'this') {
  if (held.some(one => one.item.key === item.key)) return;
  const entry: Held = {item, scope, sent: false};
  let toast = 0;
  const letGo = () => sends.delete(entry);
  const send = (keepalive = false) => {
    if (!letGo()) return;
    entry.sent = true;
    void deleteItem(item.id, {scope, occurrence_start: item.occurrence_start}, {keepalive})
      .catch(toastFailure('Failed to delete'))
      // The lists were read again before the answer came (api/items.ts), so the item has gone from them, or is back, refused.
      .finally(() => {
        held = held.filter(one => one !== entry);
        changed();
      });
  };
  const undo = () => {
    if (!letGo()) return;
    dismissToast(toast);
    held = held.filter(one => one !== entry);
    changed();
  };
  sends.set(entry, send);
  held = [...held, entry];
  changed();
  toast = showToast(`Deleted ${item.title}`, {label: 'Undo', run: undo}, undefined, () => send());
}

const setTicking = (key: string, done: boolean | null) => {
  const next = new Map(ticking);
  if (done === null) next.delete(key);
  else next.set(key, done);
  ticking = next;
  changed();
};

/**
 * Completes an open task or reopens a done one, drawn so at once, with Undo. A repeating task's
 * completion makes a done occurrence of its own (the command's item), which its Undo reopens.
 * `done` hears the command once the server has it.
 */
export function toggleDone(task: ItemOut, done?: (command: CommandOut) => void) {
  if (ticking.has(task.key)) return;
  const completing = !task.done;
  setTicking(task.key, completing);
  void completeItem(task.id, completing, task.recurring && completing ? task.due_date : null)
    .then(command => {
      done?.(command);
      showToast(`${completing ? 'Completed' : 'Reopened'} ${task.title}`, {
        label: 'Undo',
        run: () => void completeItem(command.target_id, !completing).catch(toastFailure(completing ? 'Failed to reopen' : 'Failed to complete')),
      });
    })
    .catch(toastFailure(completing ? 'Failed to complete' : 'Failed to reopen'))
    .finally(() => setTicking(task.key, null));
}

/**
 * The editor sheet's Create: says what it made, with Undo deleting it again. A task with no date
 * isn't on the calendar, so it has no Undo here.
 */
export function createFromSheet(inputs: ItemCreateInput[], onDone?: () => void) {
  if (!inputs.length) return;
  const title = inputs.length > 1 ? `${inputs.length} items` : inputs[0]!.title;
  void createItems(inputs).then(commands => {
    onDone?.();
    const undated = inputs.some(input => input.kind === 'task' && !input.due_date);
    showToast(`Created ${title}`, undated ? null : {
      label: 'Undo',
      run: () => commands.forEach(command => void deleteItem(command.target_id).catch(toastFailure('Failed to undo'))),
    });
  }, toastFailure(`Failed to create ${title}`));
}

/**
 * The editor sheet's Save: says so, with Undo putting the item back as it was. A change to a
 * repeating event's occurrences can't be undone, as on the desktop: the line alone.
 */
export function saveFromSheet(item: ItemOut, changes: ItemChanges, scope: RecurringScope, onDone?: () => void) {
  void updateItem(item.id, {changes, scope, occurrence_start: item.occurrence_start}).then(() => {
    onDone?.();
    const line = changes.due_date === null ? `Took the date off ${item.title}` : `Saved ${changes.title ?? item.title}`;
    showToast(line, item.recurring ? null : {
      label: 'Undo',
      run: () => void updateItem(item.id, {changes: inverseOf(item, changes), scope: 'this', occurrence_start: null}).catch(toastFailure('Failed to undo')),
    });
  }, toastFailure('Failed to change'));
}
