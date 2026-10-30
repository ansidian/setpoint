// The full posting (DESIGN.md › The application's detail; board 33, D307): a 44 px row under the lists,
// "Full posting", how it was found, the link's host and Show. Show, or Space on its row, turns the row
// into the section's sticky head and unfolds the text under it over 260 ms (a clip from the top, its
// paragraphs fading in over 180 ms from 60 ms), while the pane scrolls the head up under the tools, so
// the summary and lists slide away rather than the text appearing off screen. Collapse, the head or
// Esc folds it back over 180 ms and scrolls back to the row. The text is the posting's own words,
// cleaned to markdown and never rewritten. Arriving from mail's JD popover (#271), it's unfolded
// already, the pane at it, with no motion.
import type {PostingOut} from '@setpoint/shared';
import {Fragment, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState} from 'react';
import type {ReactNode, Ref} from 'react';
import {localDate} from '../../logic/format.ts';
import {motion} from '../../tokens.ts';
import {Icon} from '../../ui/Icon.tsx';
import {bareLink, dayWord, foundLine, hostOf} from './words.ts';

/** What the pane asks of it: Esc folds it, if it's open. */
export interface FullPostingHandle {
  escape: () => boolean;
}

// cubic-bezier(.2,0,0,1), motion.ease, for the pane's scroll, which CSS can't animate.
function ease(t: number): number {
  const [x1, y1, x2, y2] = [0.2, 0, 0, 1];
  const at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (at(x1, x2, mid) < t) lo = mid;
    else hi = mid;
  }
  return at(y1, y2, (lo + hi) / 2);
}

/** Scrolls `scroller` to `top` over `ms`, on the shared easing; the returned function stops it. */
function scrollOver(scroller: HTMLElement, top: number, ms: number): () => void {
  const from = scroller.scrollTop;
  const start = performance.now();
  let frame = 0;
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    scroller.scrollTop = from + (top - from) * ease(t);
    if (t < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

/** The posting's markdown as blocks: headings, paragraphs and lists, its inline marks dropped. */
export function blocks(markdown: string): ReactNode[] {
  const inline = (line: string) => line.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/(\*\*|__|`)/g, '');
  const out: ReactNode[] = [];
  let list: {ordered: boolean; items: string[]} | null = null;
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) out.push(<p key={out.length}>{inline(paragraph.join(' '))}</p>);
    paragraph = [];
    if (list) {
      const items = list.items.map((item, index) => <li key={index}>{inline(item)}</li>);
      out.push(list.ordered ? <ol key={out.length}>{items}</ol> : <ul key={out.length}>{items}</ul>);
    }
    list = null;
  };
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (!line) flush();
    else if (heading) {
      flush();
      out.push(<h3 key={out.length}>{inline(heading[1]!)}</h3>);
    } else if (bullet || numbered) {
      if (paragraph.length || (list && list.ordered !== Boolean(numbered))) flush();
      list ??= {ordered: Boolean(numbered), items: []};
      list.items.push((bullet ?? numbered)![1]!);
    } else if (list && raw.startsWith(' ')) list.items[list.items.length - 1] += ` ${line}`;
    else {
      if (list) flush();
      paragraph.push(line);
    }
  }
  flush();
  return out;
}

export function FullPosting({posting, title, company, timeZone, today, arrived = false, ref}: {
  posting: PostingOut;
  title: string;
  company: string;
  timeZone: string;
  today: string;
  arrived?: boolean;
  ref?: Ref<FullPostingHandle>;
}) {
  const [state, setState] = useState<'row' | 'open' | 'folding'>(arrived ? 'open' : 'row');
  // Unfolded as it was drawn: no unfolding, and the pane at it at once.
  const [still, setStill] = useState(arrived);
  const root = useRef<HTMLDivElement>(null);
  // Where the pane stood before it unfolded, to go back to; and the pane's scroll under way, so a
  // fold started while it unfolds takes over from it.
  const before = useRef(0);
  const scrolling = useRef<() => void>(() => {});
  const scrollPane = (pane: HTMLElement, top: number, ms: number) => {
    scrolling.current();
    scrolling.current = scrollOver(pane, top, ms);
  };
  useEffect(() => () => scrolling.current(), []);
  const scroller = () => root.current?.closest<HTMLElement>('.rd-scroll') ?? null;

  const unfold = () => {
    before.current = scroller()?.scrollTop ?? 0;
    setStill(false);
    setState('open');
  };
  const fold = () => setState(current => (current === 'open' ? 'folding' : current));
  useImperativeHandle(ref, () => ({
    escape: () => {
      if (state !== 'open') return false;
      fold();
      return true;
    },
  }), [state]);

  // Unfolded: the pane scrolls the head up under the tools as the text unfolds.
  useLayoutEffect(() => {
    const pane = scroller();
    if (state !== 'open' || !pane || !root.current) return;
    const top = root.current.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
    if (still) {
      scrolling.current();
      pane.scrollTop = Math.max(0, top);
    } else scrollPane(pane, Math.max(0, top), motion.slow);
  }, [state, still]);
  // Folding: back to the row once the text has folded away, the pane going back to where it was.
  useEffect(() => {
    if (state !== 'folding') return;
    const pane = scroller();
    if (pane) scrollPane(pane, before.current, motion.medium);
    const timer = window.setTimeout(() => setState('row'), motion.medium);
    return () => window.clearTimeout(timer);
  }, [state]);

  const how = foundLine(posting, timeZone, today);
  if (state === 'row') {
    return (
      <div ref={root} className="jb-src can" tabIndex={0} role="group" aria-label="Full posting"
        onClick={event => {
          if (!(event.target as Element).closest('a, button')) unfold();
        }}
        onKeyDown={event => {
          if (event.key === ' ' && event.target === event.currentTarget) {
            event.preventDefault();
            unfold();
          }
        }}>
        <Icon name="article" size={17} />
        <span className="t">Full posting</span>
        <span className="how">{how}</span>
        {posting.link && (
          <a className="tool host" href={posting.link} target="_blank" rel="noopener noreferrer" title={posting.link}>
            <Icon name="link" size={16} /><span>{hostOf(posting.link)}</span>
          </a>
        )}
        <button className="tool" type="button" aria-expanded="false" onClick={unfold}>Show<Icon name="expand_more" size={16} /></button>
      </div>
    );
  }
  const kept = dayWord(localDate(posting.found_at, timeZone), today);
  return (
    <div ref={root} className="jb-posting">
      <div className="jb-fullhead" onClick={event => {
        if (!(event.target as Element).closest('button')) fold();
      }}>
        <Icon name="article" size={16} />
        <span className="t">Full posting</span>
        <span className="ell">{title} · {company}</span>
        <button className="btn quiet sm" type="button" aria-expanded="true" onClick={fold}>Collapse<Icon name="expand_less" size={16} /></button>
      </div>
      <div className={['jb-unfold', state === 'folding' && 'folding', still && 'still'].filter(Boolean).join(' ')}>
        <div className="jb-facts">
          <span><Icon name="travel_explore" size={16} />{how}</span>
          {posting.link && <a href={posting.link} target="_blank" rel="noopener noreferrer"><Icon name="link" size={16} /><span>{bareLink(posting.link)}</span></a>}
          <span><Icon name="lock_clock" size={16} />Kept as it was on {kept}</span>
        </div>
        <div className="jb-full">{blocks(posting.full_text).map((block, index) => <Fragment key={index}>{block}</Fragment>)}</div>
      </div>
    </div>
  );
}
