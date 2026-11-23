// The phone's Overdue group (in the desktop banner's place): the open Todoist tasks overdue
// over the banner's 30 days, the most recently due first, without those a snooze holds off. The
// Agenda shows them at the top of today and its tab counts them. A snooze is the banner's: 1 hour, 3
// hours or Tomorrow, kept in this browser (overdueSnoozed.ts) until it ends or the task moves on.
import type {ItemOut, ItemsOut, Settings} from '@setpoint/shared';
import {useEffect, useSyncExternalStore} from 'react';
import {serverNow, timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {itemsPath, SETTINGS_PATH} from '../../api/items.ts';
import {overdueTasks} from '../../logic/overdue.ts';
import {arrivalTasks, bannerRange, isSnoozed, keptSnoozes, snoozeFor, snoozeUntil} from '../../logic/overdueBanner.ts';
import type {SnoozeChoice} from '../../logic/overdueBanner.ts';
import {useNow} from '../clock.ts';
import {onSnoozes, readSnoozes, snoozesVersion, writeSnoozes} from '../overdueSnoozed.ts';
import {usePhoneChanges} from '../phone/itemActions.ts';

/** The overdue tasks not snoozed, as the phone shows them: a delete waiting out its toast gone, a tick at once. */
export function useOverdue(): ItemOut[] {
  const now = useNow();
  const zone = timeZone();
  const range = bannerRange(now, zone);
  const {data} = useResource<ItemsOut>(itemsPath(range.from, range.to));
  const {gone, ticking} = usePhoneChanges();
  // Read again whenever the snoozes change.
  useSyncExternalStore(onSnoozes, snoozesVersion);
  // Snoozes no longer needed go, as each of the banner's arrivals drops them.
  useEffect(() => {
    if (data) writeSnoozes(keptSnoozes(readSnoozes(), data.items, serverNow()));
  }, [data]);
  if (!data) return [];
  const items = data.items.flatMap(item => (gone(item) ? [] : ticking.has(item.key) ? [{...item, done: ticking.get(item.key)!}] : [item]));
  const snoozes = readSnoozes();
  return arrivalTasks(overdueTasks(items, now, zone), zone).map(task => task.item).filter(item => !isSnoozed(item, snoozes, now));
}

/** Snoozes a task for `choice`, Tomorrow at Settings' task time, and says when a choice would end. */
export function useSnoozeOverdue(): {snooze: (item: ItemOut, choice: SnoozeChoice) => void; until: (choice: SnoozeChoice) => number} {
  const {data: settings} = useResource<Settings>(SETTINGS_PATH);
  const taskTime = settings?.reminders.task_time ?? null;
  const until = (choice: SnoozeChoice) => snoozeUntil(choice, serverNow(), taskTime, timeZone());
  return {
    until,
    snooze: (item, choice) => writeSnoozes([...readSnoozes().filter(kept => kept.id !== item.id), snoozeFor(item, until(choice))]),
  };
}
