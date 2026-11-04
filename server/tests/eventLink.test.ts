// SV-179 (D439): an event's link for Open, read by the server into ItemOut's `link`: a web link in
// its place (SV-77's rule, DESIGN.md #245), else its own URL (Google's source.url), else none.
import {eventLink, webLink} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';

describe('an event\'s link', () => {
  test.each([
    ['nothing', null, null, null, null],
    ['a place with no link and no URL', 'Smile Dental', '1420 Elm St', null, null],
    ['a link as the place', 'https://meet.example.com/j/1', null, null, 'https://meet.example.com/j/1'],
    ['the place\'s link wins over the URL', 'https://meet.example.com/j/1', null, 'https://jobs.example.com/apply/1', 'https://meet.example.com/j/1'],
    ['a link among the place\'s words', 'Room 204 or https://meet.example.com/j/1', null, 'https://conf.example.org/1', 'https://meet.example.com/j/1'],
    ['www. in the place takes https', 'www.meet.example.com/j/1', null, null, 'https://www.meet.example.com/j/1'],
    ['a place without a link takes the URL', 'Hall B', null, 'https://conf.example.org/talks/keynote', 'https://conf.example.org/talks/keynote'],
    ['no place takes the URL, trimmed', null, null, '  https://conf.example.org/1  ', 'https://conf.example.org/1'],
    ['plain http counts', null, null, 'http://conf.example.org/1', 'http://conf.example.org/1'],
    // A bare domain in the place, with a real top-level domain (shared/src/tlds.ts), opens as https (Andy, 2026-11-04).
    ['a bare domain alone', 'stream.example.tv/live', null, null, 'https://stream.example.tv/live'],
    ['a bare domain among words', 'Watch at stream.example.tv/live', null, 'https://conf.example.org/1', 'https://stream.example.tv/live'],
    ['a bare domain with no path', 'Sign up at example.com', null, null, 'https://example.com'],
    ['a bare domain ends before punctuation', 'Live (stream.example.tv/live).', null, null, 'https://stream.example.tv/live'],
    ['a bare domain ends before a comma', 'example.com/rsvp, Hall B', null, null, 'https://example.com/rsvp'],
    ['a bare domain in an address Google kept on the line', 'Hall B', 'example.com/map', null, 'https://example.com/map'],
    ['any case', 'Stream.Example.TV/live', null, null, 'https://Stream.Example.TV/live'],
    ['a decimal isn\'t one', 'Room 3.14', null, 'https://conf.example.org/1', 'https://conf.example.org/1'],
    ['a name with a dot isn\'t one', 'St.Louis Hall', null, null, null],
    ['a version isn\'t one', 'Build v2.0 demo', null, null, null],
    ['an email address isn\'t one', 'Ask someone@example.com', null, null, null],
    ['a made-up top-level domain isn\'t one', 'contoso.example', null, null, null],
    ['endings that read as file names aren\'t (.zip, .mov, .md)', 'notes.zip, clip.mov or README.md', null, null, null],
    ['a later bare domain after a miss', 'St.Louis or example.com/live', null, null, 'https://example.com/live'],
    ['the event\'s own URL still needs its scheme', null, null, 'stream.example.tv/live', null],
    ['only http and https: javascript:', null, null, 'javascript:alert(1)', null],
    ['only http and https: ftp', 'ftp://files.example.org/1', null, 'mailto:someone@example.com', null],
    ['a URL with spaces isn\'t one', null, null, 'https://conf.example.org/a b', null],
    ['a URL with no host isn\'t one', null, null, 'https://', null],
  ])('%s', (_, place, address, source_url, link) => expect(eventLink({place, address, source_url})).toBe(link));

  test('a web link\'s host loses its www.', () => {
    expect(webLink('https://www.conf.example.org/1')).toEqual({url: 'https://www.conf.example.org/1', host: 'conf.example.org'});
  });
});
