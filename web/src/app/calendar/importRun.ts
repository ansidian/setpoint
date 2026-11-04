// SV-181: the .ics import under review, and its run (D437). Kept in the module, as the editor's kept
// drafts are, so a run carries on while the user looks at another page. Events go one at a time, each
// waiting for Google's answer (`untilSettled`); one Google refuses stays in the list with its words
// and Retry, so a partial import never reads as done. Once every event has gone, the review closes
// and the toast says so, with Undo deleting the events the import created (never ones it updated).
import type {IcsEventOut, IcsReadOut} from '@setpoint/shared';
import {useSyncExternalStore} from 'react';
import {ApiFailure} from '../../api/client.ts';
import {importIcsEvent} from '../../api/icsImport.ts';
import {deleteItem, retryChange, untilSettled} from '../../api/items.ts';
import {icsLanding, importedLine, importOf, initialTicks, runCounts} from '../../logic/icsImport.ts';
import type {RowState} from '../../logic/icsImport.ts';
import {navigate} from '../router.ts';
import {showToast, toastFailure} from '../toast.ts';

export interface ImportReview {
  // The file's name, for the pane's heading.
  name: string;
  read: IcsReadOut;
  ticked: ReadonlySet<string>;
  // The calendar picked; null takes the page's default (the first Google calendar shown).
  calendarId: number | null;
  // Each event sent: sending, done or refused.
  rows: ReadonlyMap<string, RowState>;
  // The events the run takes, in order, once Import is pressed.
  order: string[] | null;
  running: boolean;
}

let review: ImportReview | null = null;
const listeners = new Set<() => void>();
const set = (next: ImportReview | null) => {
  review = next;
  listeners.forEach(listener => listener());
};
const update = (change: (current: ImportReview) => Partial<ImportReview>) => {
  if (review) set({...review, ...change(review)});
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useImportReview = () => useSyncExternalStore(subscribe, () => review);

// A file of one event, handed to Calendar to open in the editor as a draft once it's drawn: from
// Calendar's own picker or drop, or from an email's .ics on another page (SV-182).
let handed: IcsEventOut | null = null;
export const useHandedIcs = () => useSyncExternalStore(subscribe, () => handed);
export function handIcs(event: IcsEventOut | null) {
  handed = event;
  listeners.forEach(listener => listener());
}

/**
 * SV-182: an email's .ics, read, lands as a file from Calendar does (icsLanding): nothing to import
 * says so in the toast (D444); otherwise Calendar opens on the event's day, one event in the editor
 * and two or more in the review.
 */
export function landIcs(name: string, read: IcsReadOut, timeZone: string) {
  const landing = icsLanding(read, timeZone);
  if (landing.kind === 'nothing') {
    showToast(landing.line);
    return;
  }
  if (landing.kind === 'draft') handIcs(landing.event);
  else openReview(name, read);
  navigate({page: 'calendar', date: landing.date, item: null, at: null});
}

/** A file of two or more events opens the review, its past events unticked. */
export function openReview(name: string, read: IcsReadOut) {
  set({name, read, ticked: initialTicks(read.events), calendarId: null, rows: new Map(), order: null, running: false});
}

/** Cancel, Esc or Close. A run under way finishes the event it's sending and stops there. */
export function closeReview() {
  set(null);
}

export function tick(uid: string, on: boolean) {
  update(current => {
    const ticked = new Set(current.ticked);
    if (on) ticked.add(uid);
    else ticked.delete(uid);
    return {ticked};
  });
}

export const tickAll = (on: boolean) => update(current => ({ticked: on ? new Set(current.read.events.map(event => event.ical_uid)) : new Set()}));
export const pickCalendar = (calendarId: number) => update(() => ({calendarId}));

const setRow = (uid: string, row: RowState) => update(current => ({rows: new Map(current.rows).set(uid, row)}));

/** Google's answer for one event, as its row. A change still waiting after a minute is on the grid, pending: it counts as sent. */
async function settle(uid: string, sent: Promise<Awaited<ReturnType<typeof importIcsEvent>>>, owner: ImportReview) {
  try {
    const command = await untilSettled(await sent);
    if (review?.read !== owner.read) return;
    if (command.state === 'failed') setRow(uid, {state: 'failed', message: command.provider_message ?? 'Google Calendar refused it.', commandId: command.id});
    else setRow(uid, {state: 'done', created: command.kind === 'item_create', itemId: command.target_id});
  } catch (error) {
    if (review?.read !== owner.read) return;
    setRow(uid, {state: 'failed', message: error instanceof ApiFailure ? error.message : 'Setpoint couldn\'t send it.', commandId: null});
  }
}

/** Import N events: each ticked event in the list's order, one at a time, into `calendarId`. */
export async function runImport(calendarId: number, calendarName: string) {
  const owner = review;
  if (!owner || owner.running) return;
  const order = owner.read.events.filter(event => owner.ticked.has(event.ical_uid)).map(event => event.ical_uid);
  set({...owner, calendarId, order, running: true, rows: new Map()});
  for (const uid of order) {
    if (review?.read !== owner.read) return;
    const event = owner.read.events.find(one => one.ical_uid === uid)!;
    setRow(uid, {state: 'sending'});
    await settle(uid, importIcsEvent(calendarId, importOf(event)), owner);
  }
  if (review?.read !== owner.read) return;
  update(() => ({running: false}));
  finish(calendarName);
}

/** A refused event's Retry: Try again on its command, or the import sent again when none was made. */
export async function retryRow(uid: string, calendarName: string) {
  const owner = review;
  const row = owner?.rows.get(uid);
  if (!owner || row?.state !== 'failed' || owner.calendarId === null) return;
  const event = owner.read.events.find(one => one.ical_uid === uid)!;
  setRow(uid, {state: 'sending'});
  await settle(uid, row.commandId === null ? importIcsEvent(owner.calendarId, importOf(event)) : retryChange(row.commandId), owner);
  if (review?.read === owner.read && !review.running) finish(calendarName, true);
}

/** Every event sent: the toast says how many went, with Undo; the review closes once none was refused. */
function finish(calendarName: string, retried = false) {
  if (!review?.order) return;
  const {done, failed} = runCounts(review.order, review.rows);
  // A Retry that leaves others refused says nothing yet: the list still shows them.
  if (retried && failed) return;
  const created = review.order.flatMap(uid => {
    const row = review!.rows.get(uid);
    return row?.state === 'done' && row.created ? [row.itemId] : [];
  });
  if (!failed) closeReview();
  if (done) showToast(importedLine(done, calendarName), created.length ? {label: 'Undo', run: () => void undoImport(created)} : null);
}

/** Undo: the events the import created are deleted (a series whole); ones it updated stay as they now are. */
async function undoImport(itemIds: number[]) {
  try {
    for (const id of itemIds) await deleteItem(id, {scope: 'all'});
  } catch (error) {
    toastFailure('Couldn\'t undo the import')(error);
  }
}

/** One event imported from the editor (D437): sent as the review sends one, with the same toast. */
export async function importFromEditor(calendarId: number, calendarName: string, event: Parameters<typeof importIcsEvent>[1]) {
  try {
    const command = await untilSettled(await importIcsEvent(calendarId, event));
    if (command.state === 'failed') {
      showToast(`Couldn't import ${event.title || 'it'}, ${command.provider_message ?? 'Google Calendar refused it.'}`, {
        label: 'Try again', run: () => void retryChange(command.id).catch(toastFailure('Couldn\'t try again')),
      }, 'failed');
      return;
    }
    showToast(importedLine(1, calendarName).replace('1 event', event.title || '1 event'), command.kind === 'item_create' ? {label: 'Undo', run: () => void undoImport([command.target_id])} : null);
  } catch (error) {
    toastFailure(`Couldn't import ${event.title || 'it'}`)(error);
  }
}
