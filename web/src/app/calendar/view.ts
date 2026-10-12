// What the Calendar page and the sidebar's Calendar section share besides the address: the month
// the grid shows (the header's title, the tab's), the month the mini-month shows (it follows the
// grid, and ‹ › step it on its own), the week the week view shows (its Sunday), and the requests to
// scroll the grid. The selected day and item, and which view, live in the address (logic/route.ts).
import {useSyncExternalStore} from 'react';
import type {Rect} from '../../logic/calendar.ts';

/**
 * Scroll the grid: a month to the top, or a day into view if it isn't. Paging and Today glide there
 * (polish audit grids-04); a jump (Month from Week, a link) lands at once.
 */
export type ScrollRequest = {kind: 'month'; month: string; how: MonthMove; seq: number} | {kind: 'day'; date: string; seq: number};
export type MonthMove = 'page' | 'today' | 'jump';

export interface CalendarView {
  shown: string | null;
  mini: string | null;
  // The selected day, for the mini-month.
  selected: string | null;
  scroll: ScrollRequest | null;
  // The selected item's chip, relative to the month section, for F5's floating detail.
  anchor: {key: string; rect: Rect} | null;
  // The week view's week, its Sunday, and how it got there: paged (the hours keep their scroll) or
  // shown afresh (a day from elsewhere, Today: the hours open as DESIGN.md › Week view says).
  week: string | null;
  weekJump: number;
  // The month the grid is gliding to, so paging again goes on from there (N N N), not from the month passing by.
  gliding: string | null;
}

let view: CalendarView = {shown: null, mini: null, selected: null, scroll: null, anchor: null, week: null, weekJump: 0, gliding: null};
let seq = 0;
const listeners = new Set<() => void>();
const set = (next: Partial<CalendarView>) => {
  view = {...view, ...next};
  listeners.forEach(listener => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useCalendarView = () => useSyncExternalStore(subscribe, () => view);

/** The grid scrolled into another month; the mini-month follows it. */
export function setShownMonth(month: string) {
  if (view.shown !== month) set({shown: month, mini: month});
}

export function setSelectedDay(date: string) {
  if (view.selected !== date) set({selected: date});
}

/** ‹ › in the sidebar: the mini-month only. */
export const stepMini = (month: string) => set({mini: month});

export const scrollToMonth = (month: string, how: MonthMove = 'jump') => set({scroll: {kind: 'month', month, how, seq: ++seq}, gliding: how === 'jump' ? null : month});
export const revealDay = (date: string) => set({scroll: {kind: 'day', date, seq: ++seq}});

export const setAnchor = (anchor: CalendarView['anchor']) => set({anchor});

/** The month grid's glide has landed, or been stopped by the wheel, a touch or a press. */
export function stopGliding() {
  if (view.gliding !== null) set({gliding: null});
}

/**
 * T always answers (polish audit grids-11): today's disc on the grid, in the week's heads and in the
 * mini-month swells once, as Today lands, so it says "you are here" even with today already in view.
 */
export function pulseToday() {
  for (const disc of document.querySelectorAll<HTMLElement>('.dn.today, .mini > .t')) {
    if (disc.classList.contains('pulse')) {
      disc.classList.remove('pulse');
      // Taken off and put back in one frame, it plays again.
      void disc.offsetWidth;
    }
    disc.classList.add('pulse');
    disc.addEventListener('animationend', () => disc.classList.remove('pulse'), {once: true});
  }
}

/** The week view shows the week starting `start`: paged keeps the hours' scroll, a jump opens them afresh. */
export function showWeek(start: string, how: 'page' | 'jump') {
  if (view.week === start && how === 'page') return;
  set({week: start, weekJump: how === 'jump' ? view.weekJump + 1 : view.weekJump});
}

// Each item's day as last seen on the grid, so selecting one shows its day before GET /items/:id
// answers (a task or a single event's address has only its id).
const knownDays = new Map<string, string>();
export const rememberDay = (key: string, date: string) => knownDays.set(key, date);
export const knownDay = (key: string) => knownDays.get(key) ?? null;
