// The reading pane while emails or drafts are selected (option B), on the Inbox, Sent and Drafts. It
// shows the page's tools for the whole selection and Clear Esc at the right. Then "3 emails selected"
// (or drafts) sits where the subject goes, and under it the selection as a stack of cards. The one
// in front is the email last selected, read as the reader shows it (the page draws it: `front`), and
// showing it there reads nothing. Behind it up to 5 strips, each who it's from or to and its subject
// as its row reads them (on the Inbox a summary in the subject's place, the subject its tooltip),
// then "and 4 more". A click on a strip brings its card to the front and the selection stays. Each
// card has an × that takes it out. A card joining, leaving or coming forward moves briefly (none under
// reduced motion).
// When the tools' words don't fit, Reply, Reply all and Forward give way to their glyphs first, then
// every tool (PaneTool), as the reader's do (Reader.tsx › useToolsFit), each named in its tip then.
// From 640 to 1099 px, where a pane covers the list, it stays out of the way. The rows show the
// selection, and the keys and right-click act on it.
//
// The Inbox's tools: Done H (for the ones that can be), Trash E, Pin or Unpin P, Snooze S (its menu, when
// every one can be snoozed), Reply R, Reply all A
// and Forward F (on 2 to 5 emails, a window each), Mark read or Mark unread ⇧U. Sent's: Trash E, then
// Reply, Reply all and Forward as the Inbox's. Drafts': Open ↵, and Discard for the ones that can go.
import type {MessageRowOut} from '@setpoint/shared';
import {createContext, useContext, useLayoutEffect, useRef} from 'react';
import type {CSSProperties, ReactNode} from 'react';
import {allRowLine} from '../logic/all.ts';
import type {ToolsSize} from '../logic/reader.ts';
import {selectionOffers} from '../logic/selection.ts';
import type {IconName} from '../ui/glyphs.ts';
import {Icon} from '../ui/Icon.tsx';
import {SnoozeMenu} from './SnoozeMenu.tsx';
import type {AnswerHandlers, SelectionHandlers} from './emailActions.ts';
import {zoomOf} from './calendar/geometry.ts';
import {useReadingPaneWidth} from './readingPane.ts';
import {PaneEdge, useToolsFit} from './Reader.tsx';

// How many strips the stack draws behind its front card before "and 4 more".
const STRIPS = 5;

/** One selected row as the pane's stack shows it. */
export interface SelectionLine {
  id: number;
  // Who it's from or to, as its row draws it (a `.from` element).
  from: ReactNode;
  subject: string;
  // The tooltip on the strip: the subject when a summary takes its place.
  tip?: string | null;
  // What the × names: "Unselect Dinner Friday?".
  name: string;
}

// How much room the pane's tools have, for their tips.
const ToolsRoom = createContext<ToolsSize>('wide');

export function SelectionPane({label, heading, tools, fit = '', lines, front, onClear, onFront, onDrop}: {
  label: string;
  heading: string;
  tools: ReactNode;
  // What decides the tools (their offers), so their words are measured again when it changes.
  fit?: string;
  // The selection, its front card first (logic/selection.ts › stacked).
  lines: SelectionLine[];
  // The front card's email or draft, as it reads.
  front: ReactNode;
  onClear: () => void;
  onFront: (id: number) => void;
  onDrop: (id: number) => void;
}) {
  const width = useReadingPaneWidth();
  const {bar, size} = useToolsFit(fit, width);
  const [first, ...rest] = lines;
  const behind = rest.slice(0, STRIPS);
  const more = rest.length - behind.length;
  const stack = useSettle(lines.map(line => line.id).join());
  return (
    <section className="pane selection" aria-label={label} style={{'--readingPane': `${width}px`} as CSSProperties}>
      <PaneEdge width={width} />
      <div ref={bar} className="rd-tools" data-size={size}>
        <ToolsRoom.Provider value={size}>{tools}</ToolsRoom.Provider>
        <span className="grow" />
        <ToolsRoom.Provider value={size}><PaneTool words="Clear" icon="close" hint="escape" kbd="Esc" run={onClear} /></ToolsRoom.Provider>
      </div>
      <div className="rd-head sel-head">
        <h1 className="rd-subj">{heading}</h1>
        {more > 0 && <span className="sel-more">and {more} more</span>}
      </div>
      <div ref={stack} className="sel-stack">
        {/* The farthest back first, so the nearest sits on the front card. */}
        {[...behind].reverse().map(line => (
          <div key={line.id} className="sel-strip" data-id={line.id} style={{'--depth': behind.indexOf(line) + 1} as CSSProperties}>
            <button className="sel-front-it" type="button" data-tip={line.tip ?? undefined} onClick={() => onFront(line.id)}>
              {line.from}
              <span className="subj">{line.subject}</span>
            </button>
            <Drop line={line} onDrop={onDrop} />
          </div>
        ))}
        {first && (
          <article key={first.id} className="sel-card" data-id={first.id} aria-label={first.name}>
            <Drop line={first} onDrop={onDrop} />
            {front}
          </article>
        )}
      </div>
    </section>
  );
}

function Drop({line, onDrop}: {line: SelectionLine; onDrop: (id: number) => void}) {
  return <button className="ibtn sel-drop" type="button" aria-label={`Unselect ${line.name}`} data-tip="Unselect" onClick={() => onDrop(line.id)}><Icon name="close" size={16} /></button>;
}

const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The stack's cards glide to where they now sit when one joins, leaves or comes forward: each is
 * drawn where it was and moves to its place over 180 ms. One new to the stack rises in. The first
 * drawing and reduced motion move nothing.
 */
function useSettle(order: string) {
  const stack = useRef<HTMLDivElement>(null);
  const was = useRef<Map<string, number> | null>(null);
  useLayoutEffect(() => {
    const element = stack.current;
    if (!element) return;
    const cards = [...element.querySelectorAll<HTMLElement>(':scope > [data-id]')];
    // In the page's pixels, not the window's: the wide screen's zoom scales what a rect reads.
    const zoom = zoomOf(element);
    const now = new Map(cards.map(card => [card.dataset.id ?? '', card.getBoundingClientRect().top / zoom]));
    const before = was.current;
    was.current = now;
    if (!before || still()) return;
    const timing = {duration: 180, easing: 'cubic-bezier(.2,0,0,1)'};
    for (const card of cards) {
      const id = card.dataset.id ?? '';
      const from = before.get(id);
      const to = now.get(id) ?? 0;
      if (card.classList.contains('sel-card') && from !== undefined && from !== to) {
        // A strip come to the front opens from where its strip was.
        card.animate([{transform: `translateY(${from - to}px)`, opacity: 0.6}, {transform: 'none', opacity: 1}], timing);
      } else if (from === undefined) {
        card.animate([{transform: 'translateY(-6px)', opacity: 0}, {transform: 'none', opacity: 1}], timing);
      } else if (from !== to) {
        card.animate([{transform: `translateY(${from - to}px)`}, {transform: 'none'}], timing);
      }
    }
  }, [order]);
  return stack;
}

/** The Inbox's lines: the sender and the subject (or its summary) as the row reads them. */
export const emailLines = (rows: MessageRowOut[]): SelectionLine[] => rows.map(row => {
  const line = allRowLine(row);
  return {id: row.id, from: <span className="from">{line.from}</span>, subject: line.subject, tip: line.title, name: row.subject};
});

/** The Inbox's tools for a selection. */
export function EmailTools({rows, on}: {rows: MessageRowOut[]; on: SelectionHandlers}) {
  const offer = selectionOffers(rows);
  return (
    <>
      {offer.done > 0 && <PaneTool kind="done" words={offer.done === rows.length ? 'Done' : `Done ${offer.done}`} icon="check" hint="h" kbd="H" run={on.done} />}
      <PaneTool kind="trash" words="Trash" icon="delete" hint="e" kbd="E" run={on.trash} />
      <PaneTool words={offer.pin ? 'Pin' : 'Unpin'} icon={offer.pin ? 'keep' : 'keep_off'} hint="p" kbd="P" run={on.pin} />
      {offer.snooze && <SnoozeMenu keyed="selection" onPick={on.snooze} button={(open, toggle) => <PaneTool words="Snooze" icon="snooze" hint="s" kbd="S" menu={open} run={toggle} />} />}
      <AnswerTools rows={rows} on={on} />
      {offer.read
        ? <PaneTool words="Mark read" icon="mark_email_read" run={on.markRead} />
        : <PaneTool words="Mark unread" icon="mark_email_unread" hint="shift+u" kbd="⇧U" run={on.markUnread} />}
    </>
  );
}

/** Reply R, Reply all A and Forward F, on a selection that offers them (2 to 5 emails). */
export function AnswerTools({rows, on}: {rows: MessageRowOut[]; on: AnswerHandlers}) {
  if (!selectionOffers(rows).answer) return null;
  return (
    <>
      <PaneTool kind="answering" words="Reply" icon="reply" hint="r" kbd="R" run={on.reply} />
      <PaneTool kind="answering" words="Reply all" icon="reply_all" hint="a" kbd="A" run={on.replyAll} />
      <PaneTool kind="answering" words="Forward" icon="forward" hint="f" kbd="F" run={on.forward} />
    </>
  );
}

/**
 * One of the pane's tools: its glyph, words and key. Its words give way to the glyph when they
 * don't fit (Reply, Reply all and Forward first, `answering`), and its tip names it then.
 */
export function PaneTool({words, icon, hint, kbd, run, kind, menu}: {
  words: string;
  icon: IconName;
  hint?: string;
  kbd?: string;
  run: () => void;
  kind?: 'done' | 'trash' | 'answering';
  // A tool that opens a menu: whether it's open (its tip waits meanwhile).
  menu?: boolean;
}) {
  const room = useContext(ToolsRoom);
  const hidden = room === 'tight' || (room === 'narrow' && kind === 'answering');
  return (
    <button className={kind ? `tool ${kind}` : 'tool'} type="button" data-hint={hint} aria-label={words}
      aria-haspopup={menu === undefined ? undefined : 'menu'} aria-expanded={menu}
      data-tip={hidden && !menu ? (kbd ? `${words} · ${kbd}` : words) : undefined} onClick={run}>
      <Icon name={icon} /><span className="lbl">{words}</span>{kbd && <span className="kbd">{kbd}</span>}
    </button>
  );
}
