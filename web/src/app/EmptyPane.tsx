// The pane beside the Inbox, News and Jobs with nothing open in it (SV-217, D464): always there on a
// desktop, at the dragged width, so the list and header never move as an item opens or closes. For
// the Inbox it shows how the mail day is going (SV-218, InboxDay.tsx); News and Jobs keep a placeholder,
// the page's glyph, one line and the keys, until SV-219 and SV-220 fill theirs.
//
// In a narrow window an open item covers the list, and the empty pane comes over it only from a
// 30 px `right_panel_open` button before search, as Calendar's day does (#196): lit while showing,
// closed by the button again or Esc, on every load, and when an item opens.
import {useState} from 'react';
import type {CSSProperties, ReactNode} from 'react';
import type {IconName} from '../ui/glyphs.ts';
import {Icon} from '../ui/Icon.tsx';
import {useCompact, usePhone} from './Phone.tsx';
import {PaneEdge} from './Reader.tsx';
import {useReadingPaneWidth} from './readingPane.ts';

export interface EmptyPaneState {
  // Whether the page draws the empty pane: nothing open, and a desktop or the narrow window's button.
  drawn: boolean;
  // Whether the narrow window's button is in the header, and whether it has the pane showing.
  button: boolean;
  shown: boolean;
  toggle: () => void;
  close: () => void;
}

/** The empty pane's state for a page; `open` is whether an item has the pane. */
export function useEmptyPane(open: boolean): EmptyPaneState {
  const compact = useCompact();
  const phone = usePhone();
  const [asked, setAsked] = useState(false);
  // An item opening puts it away, as does a window wide enough to show it anyway.
  if (asked && (open || !compact)) setAsked(false);
  const shown = asked && compact && !open;
  return {
    drawn: !phone && !open && (!compact || shown),
    button: compact,
    shown,
    toggle: () => setAsked(!shown),
    close: () => setAsked(false),
  };
}

/** The narrow window's header button that shows the empty pane over the list. */
export function EmptyPaneButton({pane}: {pane: EmptyPaneState}) {
  if (!pane.button) return null;
  return (
    <button className="ibtn pane-open" type="button" aria-label="The pane" aria-pressed={pane.shown} data-tip={pane.shown ? 'Hide the pane · Esc' : 'Show the pane'}
      onClick={pane.toggle}><Icon name="right_panel_open" /></button>
  );
}

export type PaneKey = {keys: string[]; does: string};

/**
 * The empty pane: what the page puts in it, and its foot (a quiet line, then the keys) pinned to the bottom. With no `children`,
 * the placeholder: the page's glyph and one line, centred (News and Jobs, until SV-219 and SV-220).
 */
export function EmptyPane({label, glyph, line, keys, foot, children}: {label: string; glyph?: IconName; line?: string; keys: PaneKey[]; foot?: ReactNode; children?: ReactNode}) {
  const width = useReadingPaneWidth();
  return (
    <section className="pane idle" aria-label={label} style={{'--readingPane': `${width}px`} as CSSProperties}>
      <PaneEdge width={width} />
      <div className="pane-empty">
        {children ?? (
          <div className="pane-placeholder">
            {glyph && <Icon name={glyph} size={28} />}
            <p>{line}</p>
          </div>
        )}
        <footer className="pane-foot">
          {foot}
          <ul className="pane-keys">
          {keys.map(key => (
            <li key={key.does}>{key.keys.map(one => <span key={one} className="kbd">{one}</span>)}<span>{key.does}</span></li>
          ))}
          </ul>
        </footer>
      </div>
    </section>
  );
}
