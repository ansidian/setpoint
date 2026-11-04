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
    ['a bare domain in the words isn\'t a link', 'Watch at twitch.tv/example', null, null, null],
    ['a bare domain as the URL isn\'t one', null, null, 'twitch.tv/example', null],
    ['only http and https: javascript:', null, null, 'javascript:alert(1)', null],
    ['only http and https: ftp', 'ftp://files.example.org/1', null, 'mailto:someone@example.com', null],
    ['a URL with spaces isn\'t one', null, null, 'https://conf.example.org/a b', null],
    ['a URL with no host isn\'t one', null, null, 'https://', null],
  ])('%s', (_, place, address, source_url, link) => expect(eventLink({place, address, source_url})).toBe(link));

  test('a web link\'s host loses its www.', () => {
    expect(webLink('https://www.conf.example.org/1')).toEqual({url: 'https://www.conf.example.org/1', host: 'conf.example.org'});
  });
});
