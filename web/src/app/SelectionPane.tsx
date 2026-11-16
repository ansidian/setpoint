// The reading pane while emails or drafts are selected (option B), on the Inbox, Sent and Drafts. It
// shows the page's tools for the whole selection and Clear Esc at the right. Then "3 emails selected"
// (or drafts) sits where the subject goes. Each one follows in the list's order, who it's from or to
// and its subject as its row reads them (on the Inbox a summary in the subject's place, the subject
// its tooltip), with an × that takes it out. A click on one opens it.
// From 640 to 1099 px, where a pane covers the list, it stays out of the way. The rows show the
// selection, and the keys and right-click act on it.
//
// The Inbox's tools: Done H (for the ones that can be), Trash E, Pin or Unpin P, Mark read or Mark
// unread ⇧U. Sent's: Trash E. Drafts': Open ↵, and Discard for the ones that can go.
import type {MessageRowOut} from '@setpoint/shared';
import type {CSSProperties, ReactNode} from 'react';
import {allRowLine} from '../logic/all.ts';
import {selectionOffers} from '../logic/selection.ts';
import {Icon} from '../ui/Icon.tsx';
import type {SelectionHandlers} from './emailActions.ts';
import {useReadingPaneWidth} from './readingPane.ts';
import {PaneEdge} from './Reader.tsx';

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

export function SelectionPane({label, heading, tools, lines, onClear, onOpen, onDrop}: {
  label: string;
  heading: string;
  tools: ReactNode;
  lines: SelectionLine[];
  onClear: () => void;
  onOpen: (id: number) => void;
  onDrop: (id: number) => void;
}) {
  const width = useReadingPaneWidth();
  const more = lines.length - LISTED;
  return (
    <section className="pane selection" aria-label={label} style={{'--readingPane': `${width}px`} as CSSProperties}>
      <PaneEdge width={width} />
      <div className="rd-tools">
        {tools}
        <span className="grow" />
        <button className="tool" type="button" data-hint="escape" onClick={onClear}><Icon name="close" />Clear<span className="kbd">Esc</span></button>
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
      {offer.done > 0 && <button className="tool done" type="button" data-hint="h" onClick={on.done}><Icon name="check" />{offer.done === rows.length ? 'Done' : `Done ${offer.done}`}<span className="kbd">H</span></button>}
      <button className="tool trash" type="button" data-hint="e" onClick={on.trash}><Icon name="delete" />Trash<span className="kbd">E</span></button>
      <button className="tool" type="button" data-hint="p" onClick={on.pin}><Icon name={offer.pin ? 'keep' : 'keep_off'} />{offer.pin ? 'Pin' : 'Unpin'}<span className="kbd">P</span></button>
      {offer.read
        ? <button className="tool" type="button" onClick={on.markRead}><Icon name="mark_email_read" />Mark read</button>
        : <button className="tool" type="button" data-hint="shift+u" onClick={on.markUnread}><Icon name="mark_email_unread" />Mark unread<span className="kbd">⇧U</span></button>}
    </>
  );
}
