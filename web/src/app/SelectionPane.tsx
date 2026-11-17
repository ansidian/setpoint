// The reading pane while emails or drafts are selected (option B), on the Inbox, Sent and Drafts. It
// shows the page's tools for the whole selection and Clear Esc at the right. Then "3 emails selected"
// (or drafts) sits where the subject goes. Each one follows in the list's order, who it's from or to
// and its subject as its row reads them (on the Inbox a summary in the subject's place, the subject
// its tooltip), with an × that takes it out. A click on one opens it.
// When the tools' words don't fit, Reply, Reply all and Forward give way to their glyphs first, then
// every tool (PaneTool), as the reader's do (Reader.tsx › useToolsFit), each named in its tip then.
// From 640 to 1099 px, where a pane covers the list, it stays out of the way. The rows show the
// selection, and the keys and right-click act on it.
//
// The Inbox's tools: Done H (for the ones that can be), Trash E, Pin or Unpin P, Reply R, Reply all A
// and Forward F (on 2 to 5 emails, a window each), Mark read or Mark unread ⇧U. Sent's: Trash E, then
// Reply, Reply all and Forward as the Inbox's. Drafts': Open ↵, and Discard for the ones that can go.
import type {MessageRowOut} from '@setpoint/shared';
import {createContext, useContext} from 'react';
import type {CSSProperties, ReactNode} from 'react';
import {allRowLine} from '../logic/all.ts';
import type {ToolsSize} from '../logic/reader.ts';
import {selectionOffers} from '../logic/selection.ts';
import type {IconName} from '../ui/glyphs.ts';
import {Icon} from '../ui/Icon.tsx';
import type {AnswerHandlers, SelectionHandlers} from './emailActions.ts';
import {useReadingPaneWidth} from './readingPane.ts';
import {PaneEdge, useToolsFit} from './Reader.tsx';

// How many the pane lists before "and 4 more".
const LISTED = 8;

/** One selected row as the pane lists it. */
export interface SelectionLine {
  id: number;
  // Who it's from or to, as its row draws it (a `.from` element).
  from: ReactNode;
  subject: string;
  // The tooltip on the line: the subject when a summary takes its place.
  tip?: string | null;
  // What the × names: "Unselect Dinner Friday?".
  name: string;
}

// How much room the pane's tools have, for their tips.
const ToolsRoom = createContext<ToolsSize>('wide');

export function SelectionPane({label, heading, tools, fit = '', lines, onClear, onOpen, onDrop}: {
  label: string;
  heading: string;
  tools: ReactNode;
  // What decides the tools (their offers), so their words are measured again when it changes.
  fit?: string;
  lines: SelectionLine[];
  onClear: () => void;
  onOpen: (id: number) => void;
  onDrop: (id: number) => void;
}) {
  const width = useReadingPaneWidth();
  const more = lines.length - LISTED;
  const {bar, size} = useToolsFit(fit, width);
  return (
    <section className="pane selection" aria-label={label} style={{'--readingPane': `${width}px`} as CSSProperties}>
      <PaneEdge width={width} />
      <div ref={bar} className="rd-tools" data-size={size}>
        <ToolsRoom.Provider value={size}>{tools}</ToolsRoom.Provider>
        <span className="grow" />
        <ToolsRoom.Provider value={size}><PaneTool words="Clear" icon="close" hint="escape" kbd="Esc" run={onClear} /></ToolsRoom.Provider>
      </div>
      <div className="rd-scroll">
        <div className="rd-head">
          <h1 className="rd-subj">{heading}</h1>
        </div>
        <ul className="sel-list">
          {lines.slice(0, LISTED).map(line => (
            <li key={line.id} data-id={line.id}>
              <button className="sel-open" type="button" data-tip={line.tip ?? undefined} onClick={() => onOpen(line.id)}>
                {line.from}
                <span className="subj">{line.subject}</span>
              </button>
              <button className="ibtn sel-drop" type="button" aria-label={`Unselect ${line.name}`} data-tip="Unselect" onClick={() => onDrop(line.id)}><Icon name="close" size={16} /></button>
            </li>
          ))}
          {more > 0 && <li className="sel-more">and {more} more</li>}
        </ul>
      </div>
    </section>
  );
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
export function PaneTool({words, icon, hint, kbd, run, kind}: {
  words: string;
  icon: IconName;
  hint?: string;
  kbd?: string;
  run: () => void;
  kind?: 'done' | 'trash' | 'answering';
}) {
  const room = useContext(ToolsRoom);
  const hidden = room === 'tight' || (room === 'narrow' && kind === 'answering');
  return (
    <button className={kind ? `tool ${kind}` : 'tool'} type="button" data-hint={hint} aria-label={words} data-tip={hidden ? (kbd ? `${words} · ${kbd}` : words) : undefined} onClick={run}>
      <Icon name={icon} /><span className="lbl">{words}</span>{kbd && <span className="kbd">{kbd}</span>}
    </button>
  );
}
