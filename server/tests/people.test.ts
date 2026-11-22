// Recipient suggestions: the people the user has written to first, by how often and how recently,
// then people who wrote to the user and were never answered. Pure ranking as a table, then the
// endpoint on the seed.
import {describe, expect, test} from 'vitest';
import {rankPeople} from '../src/domain/people.ts';
import type {Seen} from '../src/domain/people.ts';
import {signedIn, world} from './helpers.ts';

const NOW = '2026-11-15T12:00:00Z';
const daysAgo = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString();
const seen = (address: string, days: number, name: string | null = null): Seen => ({address, name, at: daysAgo(days)});
const own = ['user@example.com', 'alias@example.com'];

describe('rankPeople', () => {
  test.each<[string, {written: Seen[]; heard: Seen[]; query: string}, string[]]>([
    ['written-to people come before senders never answered', {
      written: [seen('sam@x.org', 200)], heard: [seen('june@x.org', 1)], query: '',
    }, ['sam@x.org', 'june@x.org']],
    ['often beats once when both are recent', {
      written: [seen('ravi@x.org', 2), seen('sam@x.org', 3), seen('sam@x.org', 10), seen('sam@x.org', 20)], heard: [], query: '',
    }, ['sam@x.org', 'ravi@x.org']],
    ['recent beats long ago at the same count', {
      written: [seen('old@x.org', 300), seen('old@x.org', 310), seen('new@x.org', 5), seen('new@x.org', 6)], heard: [], query: '',
    }, ['new@x.org', 'old@x.org']],
    ['a sender the user answered counts once, as written to', {
      written: [seen('sam@x.org', 30)], heard: [seen('sam@x.org', 1), seen('june@x.org', 2)], query: '',
    }, ['sam@x.org', 'june@x.org']],
    ['senders never answered go newest first', {
      written: [], heard: [seen('a@x.org', 20), seen('b@x.org', 3), seen('a@x.org', 40)], query: '',
    }, ['b@x.org', 'a@x.org']],
    ['the user\'s own addresses never show, whatever their case', {
      written: [seen('User@Example.com', 1), seen('alias@example.com', 1)], heard: [seen('user@example.com', 1)], query: '',
    }, []],
    ['the query matches the start of the address or of a word of the name', {
      written: [seen('sam.ortiz@x.org', 1, 'Sam Ortiz'), seen('june@x.org', 1, 'June Park'), seen('kofi@samsung.example', 1, 'Kofi'), seen('pat@x.org', 1, 'Pat Osam')],
      heard: [], query: 'Sam',
    }, ['sam.ortiz@x.org']],
    ['a word of the name matches', {
      written: [seen('jp@x.org', 1, 'June Park')], heard: [seen('ravi@x.org', 1, 'Ravi Park')], query: 'par',
    }, ['jp@x.org', 'ravi@x.org']],
    ['a query of several words matches the name\'s start', {
      written: [seen('jp@x.org', 1, 'June Park'), seen('jw@x.org', 1, 'June Wu')], heard: [], query: 'june p',
    }, ['jp@x.org']],
  ])('%s', (_name, {written, heard, query}, expected) => {
    expect(rankPeople({written, heard, own, query, now: NOW, limit: 10}).map(person => person.address)).toEqual(expected);
  });

  test('a person\'s name is the latest one given, and the list stops at the limit', () => {
    const people = rankPeople({
      written: [seen('sam@x.org', 9, 'Samuel'), seen('sam@x.org', 2, 'Sam Ortiz'), seen('sam@x.org', 1, null), seen('b@x.org', 3), seen('c@x.org', 4)],
      heard: [], own, query: '', now: NOW, limit: 2,
    });
    expect(people).toEqual([{name: 'Sam Ortiz', address: 'sam@x.org'}, {name: null, address: 'b@x.org'}]);
  });
});

describe('GET /api/mail/people', () => {
  test('suggests from the seed\'s mail: written-to first, never the user, the query narrowing it', async () => {
    const w = world({seed: true});
    const api = await signedIn(w);
    const all = (await api.send('GET', '/api/mail/people')).body.people as {name: string | null; address: string}[];
    expect(all.length).toBeGreaterThan(0);
    expect(all.length).toBeLessThanOrEqual(8);
    expect(all[0]!.address).toBe('theo.walsh@example.org');
    expect(all.some(person => person.address.startsWith('user@'))).toBe(false);
    const theo = (await api.send('GET', '/api/mail/people?q=the')).body.people;
    expect(theo).toEqual([{name: 'Theo Walsh', address: 'theo.walsh@example.org'}]);
  });

  test('from: offers everyone who sent the user mail, automated too, the frequent and recent first', async () => {
    const w = world({seed: true});
    const api = await signedIn(w);
    const from = (q = '') => api.send('GET', `/api/mail/people?mode=from&q=${q}`).then(answer => (answer.body.people as {address: string}[]).map(person => person.address));
    const all = await from();
    expect(all[0]).toBe('uspsinformeddelivery@email.informeddelivery.usps.com');
    expect(await from('ind')).toEqual(['alert@indeed.example']);
    expect(await from('no-reply@n')).toEqual(['no-reply@northwind.example']);
    expect(all.some(address => address.startsWith('user@'))).toBe(false);
  });

  test('to: offers only people the user sent to; the composer\'s answer is unchanged', async () => {
    const w = world({seed: true});
    const api = await signedIn(w);
    const to = (await api.send('GET', '/api/mail/people?mode=to&limit=20')).body.people as {address: string}[];
    expect(to[0]!.address).toBe('theo.walsh@example.org');
    expect(to.map(person => person.address)).toContain('sam.ortiz@example.org');
    expect(to.map(person => person.address)).not.toContain('alert@indeed.example');
    expect((await api.send('GET', '/api/mail/people?mode=to&q=sam')).body.people).toEqual([{name: 'Sam Ortiz', address: 'sam.ortiz@example.org'}]);
    expect((await api.send('GET', '/api/mail/people?mode=compose')).body).toEqual((await api.send('GET', '/api/mail/people')).body);
  });
});
