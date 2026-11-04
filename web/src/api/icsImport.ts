// SV-181: an .ics file read for review, then its events imported one at a time (shared/src/api/
// icsImport.ts has the routes). Each import is a command, settled as any change is (untilSettled).
import type {CommandOut, IcsImportEvent, IcsReadOut} from '@setpoint/shared';
import {sendJson} from './client.ts';

/** The file's events as drafts, or an ApiFailure with the line that says why it can't be read. */
export const readIcsFile = (file: Blob) => sendJson<IcsReadOut>('POST', '/calendar/import/read', new Blob([file], {type: 'text/calendar'}));

/** One event into a Google calendar: pending until Google answers. */
export const importIcsEvent = (calendarId: number, event: IcsImportEvent) => sendJson<CommandOut>('POST', '/calendar/import', {calendar_id: calendarId, event});
