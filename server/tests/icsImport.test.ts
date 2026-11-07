// An .ics file read into import drafts (SV-178, D438), against invented files only.
import {whenProblem} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {ICS_ERRORS, ianaZone, readIcs} from '../src/domain/icsImport.ts';
import type {IcsDraft, IcsDropped, IcsRead} from '../src/domain/icsImport.ts';
import {WINDOWS_ZONE_TARGETS} from '../src/domain/windowsZones.ts';
import {APPLE_EXPORT, CONFERENCE_SCHEDULE, crlf, INTERVIEW_INVITE, OUTLOOK_SERIES, OUTLOOK_SERIES_UID} from './fixtures/icsFiles.ts';

const ZONE = 'America/Los_Angeles';
const read = (file: string | Uint8Array) => readIcs(file, {timeZone: ZONE});

function drafts(result: IcsRead): IcsDraft[] {
  if (!result.ok) throw new Error(result.error);
  for (const draft of result.drafts) {
    expect(whenProblem(draft), draft.title).toBeNull();
    for (const change of draft.changes) expect(whenProblem(change), change.title).toBeNull();
  }
  return result.drafts;
}
/** The file's one draft. */
function only(result: IcsRead): IcsDraft {
  const [draft, ...rest] = drafts(result);
  expect(rest).toEqual([]);
  if (!draft) throw new Error('No draft');
  return draft;
}
const dropped = (result: IcsRead): Partial<IcsDropped> => {
  if (!result.ok) throw new Error(result.error);
  return Object.fromEntries(Object.entries(result.dropped).filter(([, count]) => count > 0));
};

/** One VCALENDAR around some VEVENT lines. */
const calendar = (...lines: string[]) => crlf(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Example//Test//EN', ...lines, 'END:VCALENDAR']);
const event = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];

const timed = {all_day: false, start_date: null, end_date: null, due_date: null, due_at: null};
const allDay = {all_day: true, starts_at: null, ends_at: null, due_date: null, due_at: null};
const fields = {kind: 'event', location: null, description: null, url: null, transparency: 'opaque', reminders: []};
const plain = {...fields, sequence: 0, recurrence: [], changes: []};

describe('readIcs: files shaped like real ones', () => {
  test('a job board\'s interview invite: REQUEST, a padded title, the join link as LOCATION', () => {
    const result = read(crlf(INTERVIEW_INVITE));
    expect(drafts(result)).toEqual([{
      ...plain,
      ...timed,
      ical_uid: 'interview-7f3a9c@jobs.example.com',
      title: 'Interview with Contoso: Software Engineer',
      // 2 PM in New York, a week after its clocks went back.
      starts_at: '2026-11-10T19:00:00.000Z',
      ends_at: '2026-11-10T19:30:00.000Z',
      time_zone: 'America/New_York',
      location: 'https://meet.example.com/j/482-193-775',
      // The folded lines joined and the \n escapes read; its links stay in the description (D439).
      description: 'Your interview with Contoso is confirmed.\n\nJoin: https://meet.example.com/j/482-193-775\nNeed to reschedule? https://jobs.example.com/interviews/7f3a9c/reschedule\nCancel: https://jobs.example.com/interviews/7f3a9c/cancel',
      reminders: [30],
    }]);
    expect(dropped(result)).toEqual({});
  });

  test('a conference\'s schedule: free sessions in overlapping tracks, each with a URL, its categories dropped', () => {
    const result = read(crlf(CONFERENCE_SCHEDULE));
    const sessions = drafts(result);
    expect(sessions.map(draft => [draft.title, draft.starts_at, draft.ends_at])).toEqual([
      ['Opening keynote', '2026-11-12T15:00:00.000Z', '2026-11-12T16:00:00.000Z'],
      ['Typed SQL in practice', '2026-11-12T16:15:00.000Z', '2026-11-12T17:00:00.000Z'],
      ['Calendars are hard', '2026-11-12T16:15:00.000Z', '2026-11-12T17:00:00.000Z'],
      ['Accessible tables', '2026-11-12T16:30:00.000Z', '2026-11-12T17:15:00.000Z'],
      ['Closing panel', '2026-11-13T20:00:00.000Z', '2026-11-13T21:00:00.000Z'],
    ]);
    expect(sessions[1]).toMatchObject({
      ical_uid: '201@devcon.example.com',
      // Written in UTC and not repeating: shown in the user's zone. The file's X-WR-TIMEZONE and calendar name are ignored (D436).
      time_zone: null,
      transparency: 'transparent',
      url: 'https://devcon.example.com/sessions/201',
      location: 'Track A Hall, Northwind Conference Center',
      description: 'Typed SQL in practice, a session at Northwind DevCon.',
      reminders: [],
    });
    expect(dropped(result)).toEqual({categories: 5});
  });

  test('Outlook\'s weekly meeting: a Windows zone, an EXDATE, one occurrence moved and one cancelled', () => {
    const [series, ...rest] = drafts(read(crlf(OUTLOOK_SERIES)));
    expect(rest).toEqual([]);
    expect(series).toEqual({
      ...plain,
      ...timed,
      ical_uid: OUTLOOK_SERIES_UID,
      title: 'Fabrikam weekly sync',
      starts_at: '2026-11-03T18:00:00.000Z',
      ends_at: '2026-11-03T18:30:00.000Z',
      time_zone: 'America/Los_Angeles',
      location: 'Conference Room 4 (Fabrikam HQ)',
      reminders: [15],
      recurrence: [
        // ical.js leaves out the default INTERVAL=1.
        'RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261222T180000Z;WKST=SU',
        // The file's EXDATE and the cancelled occurrence, in UTC.
        'EXDATE:20261124T180000Z,20261201T180000Z',
      ],
      changes: [{
        ...fields,
        ...timed,
        title: 'Fabrikam weekly sync (moved)',
        starts_at: '2026-11-10T22:00:00.000Z',
        ends_at: '2026-11-10T22:30:00.000Z',
        time_zone: 'America/Los_Angeles',
        location: 'Conference Room 4 (Fabrikam HQ)',
        original_start_at: '2026-11-10T18:00:00.000Z',
        original_start_date: null,
      }],
    });
  });

  test('Apple\'s export: an all-day event\'s alert the day before, its "no alert" placeholder skipped, a multi-line location', () => {
    const result = read(crlf(APPLE_EXPORT));
    expect(drafts(result).map(draft => ({...draft, ical_uid: undefined}))).toEqual([
      {...plain, ...allDay, ical_uid: undefined, title: 'Thanksgiving dinner', start_date: '2026-11-26', end_date: '2026-11-27', time_zone: null, transparency: 'transparent', reminders: [900]},
      {...plain, ...timed, ical_uid: undefined, title: 'Haircut', starts_at: '2026-11-21T19:00:00.000Z', ends_at: '2026-11-21T19:30:00.000Z', time_zone: 'America/Los_Angeles', location: 'Tailspin Toys\n1 Example Way, Springfield'},
    ]);
    expect(dropped(result)).toEqual({});
  });
});

describe('readIcs: how the file is written', () => {
  const lunch = (...lines: string[]) => event('UID:lunch@example.com', 'SUMMARY:Lunch', 'DTSTART:20261110T200000Z', 'DTEND:20261110T210000Z', ...lines);
  const lunchDraft = {...plain, ...timed, ical_uid: 'lunch@example.com', title: 'Lunch', starts_at: '2026-11-10T20:00:00.000Z', ends_at: '2026-11-10T21:00:00.000Z', time_zone: null};

  test.each([
    ['CRLF', calendar(...lunch())],
    ['LF only', calendar(...lunch()).replaceAll('\r\n', '\n')],
    ['a BOM', `\uFEFF${calendar(...lunch())}`],
    ['a BOM in the bytes', new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(calendar(...lunch()))])],
    ['blank lines', calendar(...lunch()).replace('SUMMARY', '\r\n\r\nSUMMARY')],
  ])('%s', (_, file) => {
    expect(drafts(read(file))).toEqual([lunchDraft]);
  });

  test('folded lines, with a space or a tab, mid-word', () => {
    expect(only(read(calendar(...event('UID:fold@example.com', 'SUMMARY:Quarterly pl', ' anning with Wood', '\tgrove Bank', 'DTSTART:20261110T200000Z')))).title)
      .toBe('Quarterly planning with Woodgrove Bank');
  });

  test('escapes: comma, semicolon, backslash and newline', () => {
    const draft = only(read(calendar(...event('UID:esc@example.com', 'SUMMARY:Tea\\, cake\\; and a \\\\ backslash', 'DESCRIPTION:Line one\\nLine two\\NLine three', 'DTSTART:20261110T200000Z'))));
    expect([draft.title, draft.description]).toEqual(['Tea, cake; and a \\ backslash', 'Line one\nLine two\nLine three']);
  });

  test('several VCALENDARs in one file', () => {
    const file = calendar(...event('UID:a@example.com', 'SUMMARY:First', 'DTSTART:20261110T200000Z'))
      + calendar(...event('UID:b@example.com', 'SUMMARY:Second', 'DTSTART:20261111T200000Z'));
    expect(drafts(read(file)).map(draft => draft.title)).toEqual(['First', 'Second']);
  });

  test('an event with no UID gets one made from its start and title, the same each time', () => {
    const file = calendar(...event('SUMMARY:No UID here', 'DTSTART:20261110T200000Z'));
    const first = only(read(file));
    expect(first.ical_uid).toMatch(/^[0-9a-f]{32}@ics-import$/);
    expect(only(read(file)).ical_uid).toBe(first.ical_uid);
    expect(only(read(file.replace('No UID here', 'Another'))).ical_uid).not.toBe(first.ical_uid);
  });

  test('a title, location and description of only spaces are none', () => {
    expect(drafts(read(calendar(...event('UID:blank@example.com', 'SUMMARY:   ', 'LOCATION: ', 'DESCRIPTION:', 'DTSTART:20261110T200000Z'))))[0])
      .toMatchObject({title: '', location: null, description: null});
  });

  test('a URL that isn\'t a web link is left out', () => {
    expect(only(read(calendar(...event('UID:u@example.com', 'URL:mailto:someone@example.com', 'DTSTART:20261110T200000Z')))).url).toBeNull();
  });
});

describe('readIcs: times', () => {
  const when = (...lines: string[]) => {
    const draft = only(read(calendar(...event('UID:t@example.com', 'SUMMARY:T', ...lines))));
    const {all_day, starts_at, ends_at, start_date, end_date, time_zone} = draft;
    return {all_day, starts_at, ends_at, start_date, end_date, time_zone};
  };
  const at = (starts_at: string, ends_at: string, time_zone: string | null) => ({all_day: false, starts_at, ends_at, start_date: null, end_date: null, time_zone});
  const days = (start_date: string, end_date: string) => ({all_day: true, starts_at: null, ends_at: null, start_date, end_date, time_zone: null});

  test.each([
    ['an IANA zone', ['DTSTART;TZID=Europe/Berlin:20261110T090000', 'DTEND;TZID=Europe/Berlin:20261110T100000'], at('2026-11-10T08:00:00.000Z', '2026-11-10T09:00:00.000Z', 'Europe/Berlin')],
    ['Outlook\'s Windows name', ['DTSTART;TZID=W. Europe Standard Time:20261110T090000', 'DTEND;TZID=W. Europe Standard Time:20261110T100000'], at('2026-11-10T08:00:00.000Z', '2026-11-10T09:00:00.000Z', 'Europe/Berlin')],
    ['a Windows name in quotes', ['DTSTART;TZID="Eastern Standard Time":20261110T090000'], at('2026-11-10T14:00:00.000Z', '2026-11-10T14:00:00.000Z', 'America/New_York')],
    ['an IANA name at the end of a path', ['DTSTART;TZID=/mozilla.org/20050126_1/America/Chicago:20261110T090000'], at('2026-11-10T15:00:00.000Z', '2026-11-10T15:00:00.000Z', 'America/Chicago')],
    ['a floating time takes the user\'s zone', ['DTSTART:20261110T090000', 'DTEND:20261110T093000'], at('2026-11-10T17:00:00.000Z', '2026-11-10T17:30:00.000Z', null)],
    ['a zone nobody knows takes the user\'s zone', ['DTSTART;TZID=Somewhere Odd:20261110T090000'], at('2026-11-10T17:00:00.000Z', '2026-11-10T17:00:00.000Z', null)],
    ['seconds are kept', ['DTSTART:20261110T090030Z'], at('2026-11-10T09:00:30.000Z', '2026-11-10T09:00:30.000Z', null)],
    ['a timed event with no end has no length', ['DTSTART:20261110T200000Z'], at('2026-11-10T20:00:00.000Z', '2026-11-10T20:00:00.000Z', null)],
    ['DURATION', ['DTSTART:20261110T200000Z', 'DURATION:PT1H30M'], at('2026-11-10T20:00:00.000Z', '2026-11-10T21:30:00.000Z', null)],
    // Nov 1, 2026 is when Los Angeles's clocks go back: a day later is 9 AM again, 25 hours on.
    ['a day\'s DURATION across a clock change keeps the wall time', ['DTSTART;TZID=America/Los_Angeles:20261031T090000', 'DURATION:P1D'], at('2026-10-31T16:00:00.000Z', '2026-11-01T17:00:00.000Z', 'America/Los_Angeles')],
    ['an end before the start has no length', ['DTSTART:20261110T200000Z', 'DTEND:20261110T190000Z'], at('2026-11-10T20:00:00.000Z', '2026-11-10T20:00:00.000Z', null)],
    ['all day, with DTEND (exclusive)', ['DTSTART;VALUE=DATE:20261126', 'DTEND;VALUE=DATE:20261128'], days('2026-11-26', '2026-11-28')],
    ['all day, without DTEND, is one day', ['DTSTART;VALUE=DATE:20261126'], days('2026-11-26', '2026-11-27')],
    ['all day, with DURATION', ['DTSTART;VALUE=DATE:20261126', 'DURATION:P3D'], days('2026-11-26', '2026-11-29')],
    ['all day, with a week\'s DURATION', ['DTSTART;VALUE=DATE:20261126', 'DURATION:P1W'], days('2026-11-26', '2026-12-03')],
    ['all day, ending on its start, is one day', ['DTSTART;VALUE=DATE:20261126', 'DTEND;VALUE=DATE:20261126'], days('2026-11-26', '2026-11-27')],
  ])('%s', (_, lines, expected) => {
    expect(when(...lines)).toEqual(expected);
  });

  test('a zone only the file defines gives the instant by its own rules', () => {
    const file = calendar(
      'BEGIN:VTIMEZONE', 'TZID:Custom Pacific', 'BEGIN:STANDARD', 'DTSTART:16010101T020000', 'TZOFFSETFROM:-0700', 'TZOFFSETTO:-0800',
      'RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11', 'END:STANDARD', 'BEGIN:DAYLIGHT', 'DTSTART:16010101T020000', 'TZOFFSETFROM:-0800',
      'TZOFFSETTO:-0700', 'RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3', 'END:DAYLIGHT', 'END:VTIMEZONE',
      ...event('UID:c@example.com', 'DTSTART;TZID=Custom Pacific:20260710T090000'),
    );
    // Not the user's zone here: New York, so the file's own rules (UTC-7 in July) are what gave 16:00.
    const draft = only(readIcs(file, {timeZone: 'America/New_York'}));
    expect([draft.starts_at, draft.time_zone]).toEqual(['2026-07-10T16:00:00.000Z', null]);
  });

  test.each([
    ['Pacific Standard Time', 'America/Los_Angeles'],
    ['pacific standard time', 'America/Los_Angeles'],
    ['India Standard Time', 'Asia/Kolkata'],
    ['America/Sao_Paulo', 'America/Sao_Paulo'],
    ['UTC', 'UTC'],
    ['/citadel.org/20190914_1/Europe/London', 'Europe/London'],
    ['GMT -0500 (Standard) / GMT -0400 (Daylight)', null],
    ['Not a zone', null],
  ])('ianaZone(%j)', (tzid, zone) => {
    expect(ianaZone(tzid)).toBe(zone);
  });

  test('every Windows name maps to a zone this runtime knows', () => {
    const unknown = WINDOWS_ZONE_TARGETS.filter(zone => {
      try {
        new Intl.DateTimeFormat('en-US', {timeZone: zone});
        return false;
      } catch {
        return true;
      }
    });
    expect(unknown).toEqual([]);
  });
});

describe('readIcs: repeats', () => {
  test('RRULE with EXDATE and RDATE, a changed occurrence and a cancelled one, in the event\'s zone', () => {
    const file = calendar(
      ...event('UID:gym@example.com', 'SUMMARY:Gym', 'DTSTART;TZID=America/Los_Angeles:20261102T070000', 'DTEND;TZID=America/Los_Angeles:20261102T080000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261130T070000', 'EXDATE;TZID=America/Los_Angeles:20261104T070000,20261109T070000',
        'RDATE;TZID=America/Los_Angeles:20261107T090000'),
      ...event('UID:gym@example.com', 'RECURRENCE-ID;TZID=America/Los_Angeles:20261111T070000', 'SUMMARY:Gym (late)',
        'DTSTART;TZID=America/Los_Angeles:20261111T180000', 'DTEND;TZID=America/Los_Angeles:20261111T190000'),
      ...event('UID:gym@example.com', 'RECURRENCE-ID;TZID=America/Los_Angeles:20261116T070000', 'STATUS:CANCELLED', 'DTSTART;TZID=America/Los_Angeles:20261116T070000'),
    );
    const gym = only(read(file));
    expect(gym.recurrence).toEqual([
      // A floating UNTIL is in the event's zone: 7 AM in Los Angeles is 15:00 UTC.
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261130T150000Z',
      'EXDATE:20261104T150000Z,20261109T150000Z,20261116T150000Z',
      'RDATE:20261107T170000Z',
    ]);
    expect(gym.changes).toEqual([expect.objectContaining({
      title: 'Gym (late)', starts_at: '2026-11-12T02:00:00.000Z', ends_at: '2026-11-12T03:00:00.000Z', original_start_at: '2026-11-11T15:00:00.000Z', original_start_date: null,
    })]);
  });

  test('an all-day repeat keeps its dates', () => {
    const file = calendar(
      ...event('UID:bins@example.com', 'SUMMARY:Bins out', 'DTSTART;VALUE=DATE:20261102', 'RRULE:FREQ=WEEKLY;UNTIL=20261228', 'EXDATE;VALUE=DATE:20261123'),
      ...event('UID:bins@example.com', 'RECURRENCE-ID;VALUE=DATE:20261130', 'SUMMARY:Bins out (Tuesday)', 'DTSTART;VALUE=DATE:20261201'),
    );
    const bins = only(read(file));
    expect(bins).toMatchObject({time_zone: null, recurrence: ['RRULE:FREQ=WEEKLY;UNTIL=20261228', 'EXDATE;VALUE=DATE:20261123']});
    expect(bins.changes).toEqual([expect.objectContaining({start_date: '2026-12-01', end_date: '2026-12-02', original_start_at: null, original_start_date: '2026-11-30'})]);
  });

  test('a repeat written in UTC repeats in UTC', () => {
    const draft = only(read(calendar(...event('UID:standup@example.com', 'DTSTART:20261102T170000Z', 'RRULE:FREQ=DAILY;COUNT=5'))));
    expect([draft.time_zone, draft.recurrence]).toEqual(['UTC', ['RRULE:FREQ=DAILY;COUNT=5']]);
  });

  test('a changed occurrence whose series isn\'t in the file, or doesn\'t repeat, is dropped', () => {
    const result = read(calendar(
      ...event('UID:lonely@example.com', 'RECURRENCE-ID:20261110T200000Z', 'DTSTART:20261110T210000Z'),
      ...event('UID:single@example.com', 'DTSTART:20261110T200000Z'),
      ...event('UID:single@example.com', 'RECURRENCE-ID:20261110T200000Z', 'DTSTART:20261110T210000Z'),
    ));
    expect(drafts(result).map(draft => [draft.ical_uid, draft.changes])).toEqual([['single@example.com', []]]);
    expect(dropped(result)).toEqual({occurrence_without_series: 2});
  });
});

describe('readIcs: what\'s dropped, and why', () => {
  test.each<[string, string[], Partial<IcsDropped>, number]>([
    ['a cancelled event', event('UID:x@example.com', 'STATUS:CANCELLED', 'DTSTART:20261110T200000Z'), {cancelled: 1}, 0],
    ['a to-do, a journal entry and free/busy', [
      'BEGIN:VTODO', 'UID:todo@example.com', 'SUMMARY:Buy milk', 'END:VTODO',
      'BEGIN:VJOURNAL', 'UID:journal@example.com', 'END:VJOURNAL',
      'BEGIN:VFREEBUSY', 'UID:fb@example.com', 'END:VFREEBUSY',
    ], {not_an_event: 3}, 0],
    ['no start', event('UID:x@example.com', 'SUMMARY:Someday'), {no_start: 1}, 0],
    ['a start that can\'t be read', event('UID:x@example.com', 'DTSTART:soon'), {no_start: 1}, 0],
    ['an alarm after the start', event('UID:x@example.com', 'DTSTART:20261110T200000Z', 'BEGIN:VALARM', 'TRIGGER:PT5M', 'ACTION:DISPLAY', 'END:VALARM'), {alarm_after_start: 1}, 1],
    ['an alarm at a fixed time', event('UID:x@example.com', 'DTSTART:20261110T200000Z', 'BEGIN:VALARM', 'TRIGGER;VALUE=DATE-TIME:20261110T190000Z', 'ACTION:DISPLAY', 'END:VALARM'), {alarm_at_fixed_time: 1}, 1],
    ['categories', event('UID:x@example.com', 'DTSTART:20261110T200000Z', 'CATEGORIES:Work,Travel'), {categories: 1}, 1],
  ])('%s', (_, lines, counts, kept) => {
    const result = read(calendar(...lines));
    expect(drafts(result)).toHaveLength(kept);
    expect(dropped(result)).toEqual(counts);
  });

  test('malformed values read as missing rather than failing the file', () => {
    const result = read(calendar(
      'BEGIN:VTIMEZONE', 'TZID:Broken', 'BEGIN:STANDARD', 'TZOFFSETTO:nonsense', 'END:STANDARD', 'END:VTIMEZONE',
      ...event('UID:x@example.com', 'SUMMARY:Messy', 'DTSTART;TZID=Broken:20261110T090000', 'DTEND:later', 'DURATION:long', 'SEQUENCE:many',
        'RRULE:FREQ=WEEKLY;UNTIL=whenever', 'EXDATE:never', 'BEGIN:VALARM', 'TRIGGER:soon', 'ACTION:DISPLAY', 'END:VALARM'),
      ...event('UID:x@example.com', 'RECURRENCE-ID:sometime', 'DTSTART:20261111T200000Z'),
    ));
    expect(drafts(result).map(draft => [draft.title, draft.starts_at, draft.ends_at])).toEqual([['Messy', '2026-11-10T17:00:00.000Z', '2026-11-10T17:00:00.000Z']]);
  });

  test('the copy with the highest SEQUENCE is the one kept', () => {
    const file = calendar(
      ...event('UID:x@example.com', 'SEQUENCE:2', 'SUMMARY:Rescheduled', 'DTSTART:20261111T200000Z'),
      ...event('UID:x@example.com', 'SEQUENCE:1', 'SUMMARY:Original', 'DTSTART:20261110T200000Z'),
    );
    expect(drafts(read(file)).map(draft => [draft.title, draft.sequence])).toEqual([['Rescheduled', 2]]);
    expect(dropped(read(file))).toEqual({duplicate: 1});
  });

  test('METHOD:CANCEL imports nothing, and says it was a cancellation', () => {
    const result = read(crlf(INTERVIEW_INVITE.map(line => (line === 'METHOD:REQUEST' ? 'METHOD:CANCEL' : line))));
    expect(drafts(result)).toEqual([]);
    expect(dropped(result)).toEqual({cancelled: 1});
  });

  test('alarms: before the start kept nearest first, from the end counted from the start, past Google\'s 5 or 4 weeks dropped', () => {
    const alarm = (trigger: string) => ['BEGIN:VALARM', `TRIGGER${trigger}`, 'ACTION:DISPLAY', 'END:VALARM'];
    const result = read(calendar(...event('UID:x@example.com', 'DTSTART:20261110T200000Z', 'DTEND:20261110T210000Z',
      ...alarm(':-P1D'), ...alarm(':-PT10M'), ...alarm(':PT0S'), ...alarm(':-PT10M'), ...alarm(';RELATED=END:-PT90M'), ...alarm(';RELATED=END:-PT30M'),
      ...alarm(':-PT2H'), ...alarm(':-PT3H'), ...alarm(':-P5W'))));
    // -PT90M from a one-hour event's end is 30 minutes before its start; -PT30M from the end is after the start.
    expect(only(result).reminders).toEqual([0, 10, 30, 120, 180]);
    expect(dropped(result)).toEqual({alarm_after_start: 1, alarm_over_limit: 2});
  });

});

describe('readIcs: files it won\'t take', () => {
  test.each([
    ['plain text', 'Lunch on Tuesday at noon'],
    ['an empty file', ''],
    ['a vCard', 'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Someone\r\nEND:VCARD\r\n'],
    ['a calendar that never ends', 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261110T200000Z\r\nEND:VEVENT\r\n'],
    ['bytes that aren\'t text', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  ])('%s is unreadable', (_, file) => {
    expect(read(file)).toEqual({ok: false, error: ICS_ERRORS.unreadable});
  });
});
