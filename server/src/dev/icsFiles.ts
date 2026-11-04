// SV-182: the dev provider's .ics attachments, by file name, so `npm run dev`, `npm run try` and the
// browser checks read a real invitation through Add to calendar. Invented, as every sample is
// (example domains, Microsoft's fictional companies); any other .ics name serves its name as text,
// which the import can't read.
const crlf = (lines: string[]) => `${lines.join('\r\n')}\r\n`;

const header = (method: string) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Example Jobs//Interview Scheduler//EN', 'CALSCALE:GREGORIAN', `METHOD:${method}`];

/** The seed's interview confirmation's invite: one event, a join link as its place, a 30-minute alarm. */
const INVITE = crlf([
  ...header('REQUEST'),
  'BEGIN:VEVENT',
  'UID:interview-trey-5c21e8@jobs.example.com',
  'DTSTAMP:20260929T173000Z',
  'SEQUENCE:0',
  'STATUS:CONFIRMED',
  'ORGANIZER;CN=Trey Research Recruiting:mailto:recruiting@treyresearch.example',
  'ATTENDEE;CN=Candidate;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:candidate@example.com',
  'SUMMARY:Interview with Trey Research: Data Engineer I',
  'DTSTART:20261020T210000Z',
  'DTEND:20261020T214500Z',
  'LOCATION:https://meet.example.com/j/615-204-883',
  'DESCRIPTION:Your interview with Trey Research is confirmed.\\nJoin: https://meet.example.com/j/615-204-883',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:Reminder',
  'TRIGGER:-PT30M',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR',
]);

const session = (uid: string, title: string, start: string, end: string) => [
  'BEGIN:VEVENT', `UID:${uid}@devcon.example.com`, 'DTSTAMP:20261001T120000Z', `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${title}`,
  'LOCATION:Main Hall\\, Northwind Conference Center', 'TRANSP:TRANSPARENT', 'END:VEVENT',
];

/** A conference's schedule: three sessions on the seed's Oct 15 and 16. */
const SCHEDULE = crlf([
  ...header('PUBLISH'),
  ...session('mail-keynote', 'Opening keynote', '20261015T160000Z', '20261015T170000Z'),
  ...session('mail-panel', 'Hiring panel', '20261015T200000Z', '20261015T210000Z'),
  ...session('mail-closing', 'Closing remarks', '20261016T230000Z', '20261016T233000Z'),
  'END:VCALENDAR',
]);

/** A file that only cancels an event: nothing to import (D436, D444). */
const CANCELLED = crlf([
  ...header('CANCEL'),
  'BEGIN:VEVENT', 'UID:interview-trey-5c21e8@jobs.example.com', 'DTSTAMP:20261008T120000Z', 'SEQUENCE:1', 'STATUS:CANCELLED',
  'SUMMARY:Interview with Trey Research: Data Engineer I', 'DTSTART:20261020T210000Z', 'DTEND:20261020T214500Z', 'END:VEVENT',
  'END:VCALENDAR',
]);

export const DEV_ICS_FILES: Readonly<Record<string, string>> = {
  'invite.ics': INVITE,
  'northwind-devcon.ics': SCHEDULE,
  'cancelled.ics': CANCELLED,
};
