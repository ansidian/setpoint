// The reading pane while emails are selected (DESIGN.md #249, option B): the reader's tools for the
// whole selection, Done H (for the ones that can be), Trash E, Pin or Unpin P, Mark read or Mark
// unread ⇧U, and Clear Esc at the right; then "3 emails selected" where the subject goes, and each
// email in the list's order, sender and subject as its row reads them (a summary in the subject's
// place, the subject its tooltip), with an × that takes it out. A click on one opens it.
// From 640 to 1099 px, where a pane covers the list, it stays out of the way: the rows show the
// selection and the keys and right-click act on it.
import type {MessageRowOut} from '@setpoint/shared';
import type {CSSProperties} from 'react';
import {allRowLine} from '../logic/all.ts';
import {counted, selectionOffers} from '../logic/selection.ts';
import {Icon} from '../ui/Icon.tsx';
import type {SelectionHandlers} from './emailActions.ts';
import {useReadingPaneWidth} from './readingPane.ts';
import {PaneEdge} from './Reader.tsx';

// How many emails the pane lists before "and 4 more".
const LISTED = 8;

export function SelectionPane({rows, on, onOpen, onDrop}: {
  rows: MessageRowOut[];
  on: SelectionHandlers;
  onOpen: (id: number) => void;
  onDrop: (id: number) => void;
}) {
  const width = useReadingPaneWidth();
  const offer = selectionOffers(rows);
  const more = rows.length - LISTED;
  return (
    <section className="pane selection" aria-label="Selected emails" style={{'--readingPane': `${width}px`} as CSSProperties}>
      <PaneEdge width={width} />
      <div className="rd-tools">
        {offer.done > 0 && <button className="tool done" type="button" data-hint="h" onClick={on.done}><Icon name="check" />{offer.done === rows.length ? 'Done' : `Done ${offer.done}`}<span className="kbd">H</span></button>}
        <button className="tool trash" type="button" data-hint="e" onClick={on.trash}><Icon name="delete" />Trash<span className="kbd">E</span></button>
        <button className="tool" type="button" data-hint="p" onClick={on.pin}><Icon name={offer.pin ? 'keep' : 'keep_off'} />{offer.pin ? 'Pin' : 'Unpin'}<span className="kbd">P</span></button>
        {offer.read
          ? <button className="tool" type="button" onClick={on.markRead}><Icon name="mark_email_read" />Mark read</button>
          : <button className="tool" type="button" data-hint="shift+u" onClick={on.markUnread}><Icon name="mark_email_unread" />Mark unread<span className="kbd">⇧U</span></button>}
        <span className="grow" />
        <button className="tool" type="button" data-hint="escape" onClick={on.clear}><Icon name="close" />Clear<span className="kbd">Esc</span></button>
      </div>
      <div className="rd-scroll">
        <div className="rd-head">
          <h1 className="rd-subj">{counted(rows.length, '1 email selected', n => `${n} emails selected`)}</h1>
        </div>
        <ul className="sel-list">
          {rows.slice(0, LISTED).map(row => {
            const line = allRowLine(row);
            return (
              <li key={row.id} data-id={row.id}>
                <button className="sel-open" type="button" title={line.title ?? undefined} onClick={() => onOpen(row.id)}>
                  <span className="from">{line.from}</span>
                  <span className="subj">{line.subject}</span>
                </button>
                <button className="ibtn sel-drop" type="button" aria-label={`Unselect ${row.subject}`} title="Unselect" onClick={() => onDrop(row.id)}><Icon name="close" size={16} /></button>
              </li>
            );
          })}
          {more > 0 && <li className="sel-more">and {more} more</li>}
        </ul>
      </div>
    </section>
  );
}
