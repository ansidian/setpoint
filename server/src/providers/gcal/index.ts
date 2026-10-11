// The Google Calendar adapter: one source per Google account, made by Connect Gmail on the same
// consent (src/providers/gmail/connect.ts), with its tokens from the shared Google helper.
// - sync: the calendar list, then each calendar from its sync token (a push, or a check);
// - sweep: the same, with a full read of each calendar once a day (the reconciliation sweep);
// - watch: a push channel per calendar, only when Setpoint has a public https address to be told at;
// - execute: creates, changes (with recurring scope) and deletes events (./mutations.ts).
import type {AdapterContext, SourceAdapter} from '../../sync/adapter.ts';
import {ProviderError} from '../../sync/errors.ts';
import {GoogleTokens} from '../google/auth.ts';
import type {GoogleClient} from '../google/auth.ts';
import {CALENDAR_API, GoogleCalendarApi} from './api.ts';
import type {CalendarApiOptions} from './api.ts';
import {executeEventCommand} from './mutations.ts';
import {PUSH_PATH, reconcileWatches, renewIfMoved} from './push.ts';
import {applyCalendarList, fullReadDue, syncCalendar} from './sync.ts';

export interface GoogleCalendarOptions extends CalendarApiOptions {
  // The one Google OAuth client (Config.google), which refreshes the source's tokens.
  client: GoogleClient;
  // Setpoint's public origin; push needs an https one Google can reach (B7 sets it).
  publicUrl?: string | null;
  // Where Google posts instead, when the pages' origin isn't public (SETPOINT_WEBHOOK_ORIGIN).
  webhookOrigin?: string | null;
}

export const pushAddress = (origin: string | null | undefined) => (origin?.startsWith('https://') ? new URL(PUSH_PATH, origin).href : null);

export function googleCalendarAdapter(options: GoogleCalendarOptions): SourceAdapter {
  const tokens = new GoogleTokens(options.client);
  const api = (context: AdapterContext) => {
    if (context.source.accountId === null) throw new ProviderError('permanent', 'A Google Calendar source belongs to a Google account.');
    return new GoogleCalendarApi(options, tokens, context);
  };
  const address = pushAddress(options.webhookOrigin ?? options.publicUrl);
  const run = async (context: AdapterContext, sweeping: boolean) => {
    if (address) renewIfMoved(context.store, context.source, address);
    const calendarApi = api(context);
    const calendars = applyCalendarList(context.store, context.source, await calendarApi.calendarList());
    for (const calendar of calendars) {
      await syncCalendar(context.store, calendarApi, context.source, calendar, {full: sweeping && fullReadDue(context.store, context.source, calendar)});
    }
  };
  return {
    async sync(context) {
      await run(context, false);
      return {cursor: null};
    },
    sweep: context => run(context, true),
    ...(address ? {watch: (context: AdapterContext) => reconcileWatches(context.store, api(context), context.source, address)} : {}),
    execute: (context, command) => executeEventCommand(context.store, api(context), command),
  };
}

export {CALENDAR_API};
