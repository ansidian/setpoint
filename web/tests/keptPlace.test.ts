// Kept places' rules as tables: which address a page's way in goes to (the page, whether it's the
// one showing, what it kept), and which row a kept scroll comes back to once the list has changed.
import {expect, test} from 'vitest';
import {anchorRow, wayIn} from '../src/logic/keptPlace.ts';
import type {PlacePage} from '../src/logic/keptPlace.ts';
import type {Route} from '../src/logic/route.ts';

const inbox: Route = {page: 'inbox', open: null};
const keptEmail: Route = {page: 'inbox', open: 12, view: 'unread'};
const calendar: Route = {page: 'calendar', date: null, item: null, at: null};
const keptWeek: Route = {page: 'calendar', date: '2026-11-03', item: 11, at: null, view: 'week'};
const news: Route = {page: 'news', view: 'all', story: null, article: null};

test.each<[string, PlacePage, Route, Route | undefined, Route, boolean]>([
  ['from another page, its kept place', 'inbox', calendar, keptEmail, keptEmail, false],
  ['from another page with none kept, its fresh start', 'inbox', calendar, undefined, inbox, false],
  ['from the page itself, its fresh start, dropping what it kept', 'inbox', keptEmail, keptEmail, inbox, true],
  ['from Sent, the Inbox\'s kept place (Sent is a page of its own)', 'inbox', {page: 'sent', open: 4}, keptEmail, keptEmail, false],
  ['the calendar\'s kept date, item and view', 'calendar', inbox, keptWeek, keptWeek, false],
  ['the calendar from itself, its fresh start', 'calendar', keptWeek, keptWeek, calendar, true],
  ['the calendar\'s editor isn\'t part of its address', 'calendar', inbox, {...calendar, compose: {kind: 'event', message: 4}}, calendar, false],
  ['an item\'s editor comes back as the item', 'calendar', inbox, {...keptWeek, edit: true}, keptWeek, false],
  ['Jobs\' query from mail and From history\'s unfolding aren\'t kept', 'jobs', inbox, {page: 'jobs', open: 3, q: 'contoso', history: true}, {page: 'jobs', open: 3}, false],
  ['News from Settings\' phone page, its kept story', 'news', {page: 'settings', section: null}, {...news, story: 18}, {...news, story: 18}, false],
])('a way in: %s', (_name, page, here, kept, route, fresh) => {
  expect(wayIn(page, here, kept)).toEqual({route, fresh});
});

const kept = {keys: ['a', 'b', 'c', 'd', 'e'], at: 2, offset: -10};

test.each<[string, string[], string | null]>([
  ['the row at the top, still there', ['a', 'b', 'c', 'd', 'e'], 'c'],
  ['new mail above leaves it the same row', ['new', 'a', 'b', 'c', 'd', 'e'], 'c'],
  ['the row gone: the one after it, which took its place', ['a', 'b', 'd', 'e'], 'd'],
  ['it and the one after gone: the one before', ['a', 'b', 'e'], 'b'],
  ['the nearest either way, after first', ['a', 'e'], 'e'],
  ['only the first left', ['a'], 'a'],
  ['none of the kept rows left', ['x', 'y'], null],
])('a kept scroll\'s row: %s', (_name, present, row) => {
  expect(anchorRow(kept, new Set(present))).toBe(row);
});
