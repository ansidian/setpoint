// News's empty pane (SV-219, D466): its freshness, today's strip and the quiet facts, as their lines
// say them. No count of new stories (D87). After "·", a list takes commas (the error-copy rule).
import type {NewsDayOut} from '@setpoint/shared';
import {clockTime} from './format.ts';

const n = (value: number) => value.toLocaleString('en-US');

/**
 * "Updated 8:40 AM, next around 9:40": the page's last ranking and the next one due, the second
 * without AM or PM when it shares the first's; "Not ranked yet" before the first.
 */
export function freshnessLine(day: Pick<NewsDayOut, 'updated_at' | 'next_at'>, timeZone: string): string {
  if (!day.updated_at) return 'Not ranked yet';
  const updated = clockTime(day.updated_at, timeZone);
  if (!day.next_at) return `Updated ${updated}`;
  const next = clockTime(day.next_at, timeZone);
  const half = (time: string) => time.slice(-2);
  return `Updated ${updated}, next around ${half(next) === half(updated) ? next.slice(0, -3) : next}`;
}

/** "2 feeds failing", only for feeds failing every attempt for 6 hours; null with none. */
export const failingLine = (day: Pick<NewsDayOut, 'feeds_failing'>): string | null =>
  (day.feeds_failing ? `${n(day.feeds_failing)} ${day.feeds_failing === 1 ? 'feed' : 'feeds'} failing` : null);

export interface NewsTile {
  value: string;
  label: string;
  // What the number counts, as its tooltip.
  tip: string;
  glyph: 'article' | 'newspaper' | 'public';
}

/** Today's strip: the articles fetched, the stories they started and the outlets they came from. */
export function newsTiles(day: Pick<NewsDayOut, 'articles_today' | 'stories_today' | 'outlets_today'>): NewsTile[] {
  return [
    {value: n(day.articles_today), label: 'Articles fetched', tip: 'Articles fetched from the feeds since midnight, sorted or not', glyph: 'article'},
    {value: n(day.stories_today), label: 'Stories started', tip: 'Stories on the page first reported since midnight', glyph: 'newspaper'},
    {value: n(day.outlets_today), label: 'Outlets', tip: 'Outlets today\'s articles came from', glyph: 'public'},
  ];
}

/** "$38", whole dollars from $10, cents under. */
export const wholeDollars = (usd: number) => (usd >= 10 ? `$${Math.round(usd).toLocaleString('en-US')}` : `$${usd.toFixed(2)}`);

/** "8,214 stories · $38 of AI this month."; "No stories yet · $0.00 of AI this month." */
export function newsKeptLine(day: Pick<NewsDayOut, 'stories_total' | 'ai_this_month_usd'>): string {
  const ai = `${wholeDollars(day.ai_this_month_usd)} of AI this month`;
  if (!day.stories_total) return `No stories yet, ${ai}.`;
  return `${n(day.stories_total)} ${day.stories_total === 1 ? 'story' : 'stories'}, ${ai}.`;
}
