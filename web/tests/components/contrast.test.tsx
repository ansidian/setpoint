// Small coloured text in its worst state: each on the background that a hovered, cursor or open row
// gives it, or on its own wash, in Night and in Light. The sweep's axe sees the pages at rest only,
// so these states are checked here, at WCAG's 4.5:1 for text under 18.66 px bold. Jobs's are in
// jobs.test.tsx.
import type {ReactNode} from 'react';
import {afterAll, afterEach, expect, test} from 'vitest';
import {render} from 'vitest-browser-react';
import '../../src/app/news/news.css';
import {applyTheme} from '../../src/tokens.ts';
import {contrastOf, still} from './contrast.ts';

afterAll(still());

afterEach(() => applyTheme(document.documentElement, 'night'));

const on = (base: string, state: string | null, child: ReactNode) => (
  <div style={{background: `var(--${base})`, padding: 4}}><div style={state ? {background: `var(--${state})`} : undefined}>{child}</div></div>
);

// The frame: drawn as Night in full inside Light, on its own theme's `frame`.
const inFrame = (state: string | null, child: ReactNode) => (
  <div data-theme="night" style={{background: 'var(--frame)', padding: 4}}><div style={state ? {background: `var(--${state})`} : undefined}>{child}</div></div>
);
// A band on a content card, and its text.
const onBand = (band: string, ink: string) => (
  <div style={{background: 'var(--card)', padding: 4}}><div style={{background: band}}><span style={{color: ink, fontSize: 12, fontWeight: 600}} data-text>Today · Wed, Oct 7</span></div></div>
);

const CASES: {name: string; node: ReactNode}[] = [
  {name: 'News\'s Updated on a cursor row', node: on('card', 'sub2', <span className="nw-meta"><span className="upd" data-text>Updated 8:40 AM</span></span>)},
  {name: 'News\'s pill\'s Updated', node: on('card', null, <span className="nw-pill"><span className="upd" data-text>Updated</span></span>)},
  {name: 'a code\'s countdown on an open row', node: on('card', 'sub3', <div className="row"><span className="code-line"><span className="sum soon" data-text>Expires in 42 sec</span></span></div>)},
  {name: 'All caught up', node: on('card', null, <p className="md-need caught" data-text>All caught up</p>)},
  {name: 'Copied on an open row', node: on('card', 'sub3', <span className="code-line"><button type="button" className="btn ghost sm copy copied" data-text>Copied</button></span>)},
  {name: 'the trouble chip, open', node: on('card', null, <button type="button" className="pt-chip" aria-expanded="true" data-text>2</button>)},
  // `ink3` on the card's cursor and open row.
  {name: 'ink3 on a cursor row', node: on('card', 'sub2', <span className="ink3" data-text>8:15 PM</span>)},
  {name: 'ink3 on an open row', node: on('card', 'sub3', <span className="ink3" data-text>8:15 PM</span>)},
  {name: 'the frame\'s Reconnect, hovered', node: inFrame('sub2', <span className="acct"><span className="reconnect" data-text>Reconnect</span></span>)},
  {name: 'the frame\'s soon, hovered', node: inFrame('sub2', <span className="today-row"><span className="in soon" data-text>in 5 min</span></span>)},
  {name: 'the frame\'s now, hovered', node: inFrame('sub2', <span className="today-row"><span className="in now" data-text>now</span></span>)},
  // The red unread badge on its own fill, and Attention's count on its segment's thumb, in the frame's header.
  {name: 'the unread badge in the frame', node: inFrame(null, <span className="ubadge num" data-text>13</span>)},
  {name: 'Attention\'s count on its segment, on', node: inFrame('sub3', <span className="seg ib-views"><button type="button" className="on"><span className="n" data-text>3</span></button></span>)},
  {name: 'a band\'s header', node: onBand('var(--band)', 'var(--bandInk)')},
  {name: 'FYI\'s band\'s header', node: onBand('color-mix(in srgb, var(--accent) var(--fyiBand), var(--card))', 'var(--fyiBandInk)')},
  {name: 'Attention\'s band\'s header', node: onBand('color-mix(in srgb, var(--caution) var(--attBand), var(--card))', 'var(--caution)')},
  {name: 'today\'s band\'s header', node: onBand('color-mix(in srgb, var(--accent) var(--attBand), var(--card))', 'color-mix(in oklch, var(--accent), var(--ink) 15%)')},
];

test.each(CASES)('$name reads at 4.5:1 in Night and in Light', async ({node}) => {
  await render(<>{node}</>);
  const text = document.querySelector<HTMLElement>('[data-text]')!;
  for (const theme of ['night', 'light'] as const) {
    applyTheme(document.documentElement, theme);
    expect(contrastOf(text), theme).toBeGreaterThanOrEqual(4.5);
  }
});
